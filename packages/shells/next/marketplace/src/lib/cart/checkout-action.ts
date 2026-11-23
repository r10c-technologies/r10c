'use server';

import { createHash, randomBytes } from 'node:crypto';

import {
  digestFlowCapability,
  makeFlowCapability,
} from '@entifix/transactions';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { postFlow } from '@r10c/utils-ts-fleet';
import { Effect } from 'effect';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { runRead } from '../catalog/catalog-reads';
import { storePaths } from '../routing/paths';
import {
  checkoutServiceUrl,
  coordinatorCrossingToken,
} from './checkout-config';
import {
  acceptedFlowId,
  checkoutStartBody,
  chooseTenders,
  refusedSeller,
  type SellerLines,
  tenderField,
  tendersOffered,
} from './checkout-start';
import {
  buyerTaxOfValues,
  type CheckoutFormState,
  contactErrors,
  contactOf,
  type ContactValues,
  contactValuesOf,
  namesNoContact,
  refusalQuery,
  REFUSED_PARAM,
} from './delivery-contact';
import {
  FLOW_COOKIE,
  FLOW_TTL_SECONDS,
  type FlowTicket,
  serializeFlowTicket,
} from './flow-ticket';
import { readFlowTicket } from './flow-ticket-cookie';
import { readPricedCart } from './priced-cart';
import { reviewedTotalsOf } from './priced-cart-state';

/**
 * What a start that never became a flow says on the cart: nothing left to
 * buy, a start the coordinator did not accept, or a seller it refused because
 * they do not ship — named by the `seller` beside it (#589).
 */
export type CheckoutOutcome = 'empty' | 'failed' | 'doesNotShip' | 'quantity';

/** The SHA-256 digest of a nonce, as order-service stores a cancel capability. */
const cancelDigestOf = (nonce: string) =>
  createHash('sha256').update(nonce, 'utf8').digest('hex');

/**
 * The ticket a checkout starts under: fresh, or — on a retry — the one the
 * last attempt left, so the same `Idempotency-Key` names the same flow and a
 * retried checkout is never a second one (ADR 0073).
 */
const ticketFor = async (retry: boolean) => {
  const earlier = retry ? await readFlowTicket() : undefined;
  if (earlier !== undefined) return earlier;
  const capability = await Effect.runPromise(makeFlowCapability());
  return {
    capability: capability.nonce,
    cancelNonce: randomBytes(32).toString('hex'),
    idempotencyKey: crypto.randomUUID(),
  };
};

/**
 * Each seller's part with the tender the buyer chose at review, or the sellers
 * whose choice is missing. What a seller takes is read from the published
 * vendor, as the review page offers it (ADR 0076 §7).
 */
const tendered = async (parts: readonly SellerLines[], formData: FormData) => {
  const vendors = new Map(
    (
      await runRead(
        PublishedVendor,
        loadVendors(parts.map(part => part.vendorId)),
        [],
      )
    ).map(vendor => [vendor.vendorId, vendor]),
  );
  return chooseTenders(
    parts,
    vendorId => tendersOffered(vendors.get(vendorId)),
    vendorId => formData.get(tenderField(vendorId)),
  );
};

/**
 * Checkout, as the storefront starts it from the review step: check the
 * tender the buyer chose for each seller and their contact, price each line
 * from the published offering, and ask the coordinator to start the flow. A
 * `202` names the flow, and the buyer waits on it at its order-status page —
 * the outcome arrives on the stream, never in this response (ADR 0073).
 *
 * A missing tender or a contact the order could not be delivered to answers
 * the form's state — what was chosen and typed, and each field's error —
 * rather than a redirect, so the buyer fixes it in place (ADR 0076 §2, §7).
 * The values stay in that state alone: a URL or a cookie would keep them.
 *
 * The cart is **not** cleared here: a checkout that later fails keeps it, and
 * the settle step clears it only once the flow completed.
 */
export async function placeOrder(
  _previous: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const values = contactValuesOf(formData);
  const errors = contactErrors(values);
  const { parts } = await readPricedCart();
  const choice = await tendered(parts, formData);
  const tendersMissing = 'missing' in choice ? choice.missing : [];
  if (Object.keys(errors).length > 0 || tendersMissing.length > 0) {
    const refused: CheckoutFormState = {
      values,
      errors,
      tenders: Object.fromEntries(
        parts.flatMap(part => {
          const value = formData.get(tenderField(part.vendorId));
          return typeof value === 'string' ? [[part.vendorId, value]] : [];
        }),
      ),
      tendersMissing,
    };
    // A post made without script never gets this state back: Next renders
    // the page after it through a resume that takes no form state (#725). The
    // browser's own validation stops nearly every such post first; what still
    // arrives goes back to the review with its codes alone.
    if (!(await headers()).has('next-action')) {
      const locale = String(formData.get('locale') ?? '');
      redirect(
        `/${locale}${storePaths.checkoutReview({
          [REFUSED_PARAM]: refusalQuery(refused),
          ...(formData.get('retry') === null ? {} : { retry: '1' }),
        })}`,
      );
    }
    return refused;
  }
  return start(formData, contactOf(values), buyerTaxBodyOf(values));
}

/**
 * A retry from the order-status page, under the ticket the first attempt left.
 * It carries no contact and no tender — the status page holds neither — so it
 * sends the buyer back to the review step to state them again, still under
 * that ticket, so the same `Idempotency-Key` names the same flow.
 */
export async function checkout(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  const values = contactValuesOf(formData);
  if (namesNoContact(values)) {
    redirect(
      `/${locale}${storePaths.checkoutReview(
        formData.get('retry') === null ? {} : { retry: '1' },
      )}`,
    );
  }
  return start(formData, contactOf(values), buyerTaxBodyOf(values));
}

/** The buyer's fiscal identity as the start states it, once the form passed it. */
const buyerTaxBodyOf = (values: ContactValues) => {
  const buyerTax = buyerTaxOfValues(values);
  return buyerTax.ok ? buyerTax.value : undefined;
};

const start = async (
  formData: FormData,
  contact: unknown,
  buyerTax: unknown,
): Promise<never> => {
  const locale = String(formData.get('locale') ?? '');
  // Re-priced here rather than trusted from the review: the published price
  // at the moment the flow starts is the one the buyer pays.
  const { priced, parts: lines, totals, refusals } = await readPricedCart();

  if (priced.length === 0) {
    redirect(`/${locale}/cart?checkout=empty`);
  }

  // The decision (ADR 0082 §3): every quantity is checked against the terms
  // published now, not the ones the cart was filled under. A line they no
  // longer sell goes back to the cart, which says which one and why.
  if (refusals.size > 0) {
    redirect(`/${locale}/cart?checkout=quantity`);
  }

  // What the buyer agreed to must still be what they pay: a price that moved,
  // a line that stopped being sold, or a seller whose tender the review never
  // asked for since sends them back to review it again, rather than charging a
  // figure or a tender they never saw.
  const reviewed = formData.get('reviewed');
  const choice = await tendered(lines, formData);
  if (
    (typeof reviewed === 'string' && reviewed !== reviewedTotalsOf(totals)) ||
    'missing' in choice
  ) {
    redirect(`/${locale}${storePaths.checkoutReview({ changed: '1' })}`);
  }
  const { parts } = choice;
  const ticket = await ticketFor(formData.get('retry') !== null);
  const response = await postFlow(
    checkoutServiceUrl(),
    coordinatorCrossingToken(),
    'checkout',
    checkoutStartBody({
      parts,
      cancelDigest: cancelDigestOf(ticket.cancelNonce),
      capabilityDigest: await Effect.runPromise(
        digestFlowCapability(ticket.capability),
      ),
      contact,
      ...(buyerTax === undefined ? {} : { buyerTax }),
      locale,
    }),
    ticket.idempotencyKey,
    { cache: 'no-store' },
  ).catch(() => undefined);

  const flowId =
    response === undefined
      ? undefined
      : acceptedFlowId(response.status, response.payload);
  if (flowId === undefined) {
    const seller =
      response === undefined
        ? undefined
        : refusedSeller(response.status, response.payload);
    redirect(
      `/${locale}${storePaths.cart(
        seller === undefined
          ? { checkout: 'failed' }
          : { checkout: 'doesNotShip', seller },
      )}`,
    );
  }

  const accepted: FlowTicket = { ...ticket, flowId };
  (await cookies()).set(FLOW_COOKIE, serializeFlowTicket(accepted), {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: FLOW_TTL_SECONDS,
  });
  redirect(`/${locale}${storePaths.orderStatus(flowId)}`);
};
