'use server';

import { createHash, randomBytes } from 'node:crypto';

import {
  digestFlowCapability,
  makeFlowCapability,
} from '@entifix/transactions';
import { postFlow } from '@r10c/utils-ts-fleet';
import { Effect } from 'effect';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import {
  checkoutServiceUrl,
  coordinatorCrossingToken,
} from './checkout-config';
import {
  acceptedFlowId,
  checkoutStartBody,
  tenderField,
  tenderOf,
} from './checkout-start';
import {
  FLOW_COOKIE,
  FLOW_TTL_SECONDS,
  type FlowTicket,
  serializeFlowTicket,
} from './flow-ticket';
import { readFlowTicket } from './flow-ticket-cookie';
import { readPricedCart } from './priced-cart';
import { reviewedTotalsOf } from './priced-cart-state';

export type CheckoutOutcome = 'empty' | 'failed';

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
 * Checkout, as the storefront starts it from the review step: price each line
 * from the published offering, split the basket per seller with the tender
 * the buyer picked for each, and ask the coordinator to start the flow. A
 * `202` names the flow, and the buyer waits on it at its order-status page —
 * the outcome arrives on the stream, never in this response (ADR 0073).
 *
 * The cart is **not** cleared here: a checkout that later fails keeps it, and
 * the settle step clears it only once the flow completed.
 */
export async function checkout(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  // Re-priced here rather than trusted from the review: the published price
  // at the moment the flow starts is the one the buyer pays.
  const { priced, parts, totals } = await readPricedCart(vendorId =>
    tenderOf(formData.get(tenderField(vendorId))),
  );

  if (priced.length === 0) {
    redirect(`/${locale}/cart?checkout=empty`);
  }

  // What the buyer agreed to must still be what they pay: a price that moved
  // or a line that stopped being sold since the review sends them back to
  // review it again, rather than charging a figure they never saw. A retry
  // from the status page carries no review, and reuses a flow already priced.
  const reviewed = formData.get('reviewed');
  if (typeof reviewed === 'string' && reviewed !== reviewedTotalsOf(totals)) {
    redirect(
      `/${locale}${storePaths.checkoutReview(
        Object.fromEntries(
          parts.map(part => [part.vendorId, part.paymentMethod]),
        ),
        { changed: '1' },
      )}`,
    );
  }

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
    }),
    ticket.idempotencyKey,
    { cache: 'no-store' },
  ).catch(() => undefined);

  const flowId =
    response === undefined
      ? undefined
      : acceptedFlowId(response.status, response.payload);
  if (flowId === undefined) {
    redirect(`/${locale}/cart?checkout=failed`);
  }

  const accepted: FlowTicket = { ...ticket, flowId };
  (await cookies()).set(FLOW_COOKIE, serializeFlowTicket(accepted), {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: FLOW_TTL_SECONDS,
  });
  redirect(`/${locale}${storePaths.orderStatus(flowId)}`);
}
