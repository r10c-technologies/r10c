'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getOffering } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { readCart } from './cart-cookie';
import { CART_COOKIE, type CartLine } from './cart-state';
import { checkoutServiceUrl, sagaCrossingToken } from './checkout-config';
import {
  type Receipt,
  RECEIPT_COOKIE,
  RECEIPT_TTL_SECONDS,
  receiptFromOrder,
  type ReceiptLine,
  serializeReceipt,
} from './receipt-state';

/** One line as the checkout saga needs it, priced from what the buyer was shown. */
interface CheckoutLine {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
}

/** What the storefront tells the caller happened, as a search param. */
export type CheckoutOutcome = 'placed' | 'unavailable' | 'empty' | 'failed';

/**
 * Turn the cart cookie into a `ProductOrder`.
 *
 * ⚠️ **The price is captured here, from the published offering the buyer was
 * shown.** It travels on the line and is never read through again: an offering's
 * price can change between the cart and the payment, and a buyer must be charged
 * the price they were shown ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * ⚠️ **This calls transaction-service, never stock-service.** A Next backend
 * binds no datastore and holds no participant token — the `host:next` /
 * `runtime:datastore` boundary rule fails the build on the first — and the
 * reserve is a step the coordinator dispatches, not something a storefront does
 * on its own ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * ⚠️ **The crossing token is read in this module and never reaches the
 * browser.** `'use server'` is what keeps that true: the storefront has no auth
 * gate, so it cannot prove *who* the buyer is — what it proves is that the fleet
 * is asking, which is what a crossing token is for. It is the coordinator's
 * inbound token, deliberately not a participant's: it starts a flow, it does not
 * write a vendor's stock.
 *
 * A line whose offering has vanished since it was added is **dropped**, not
 * failed: the cart page already renders only present offerings, and refusing the
 * whole basket for one unpublished item is worse for the buyer than checking out
 * the rest.
 */
export async function checkout(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  const lines = await readCart();

  const priced = (
    await Promise.all(
      lines.map(async (line: CartLine): Promise<CheckoutLine | undefined> => {
        const offering = await getOffering(line.offeringId);
        if (!offering) return undefined;
        return {
          offeringId: line.offeringId,
          // The organization the hold is taken against. It comes from the
          // *item*, because a buyer's session names no organization and never
          // will (ADR 0023).
          vendorId: offering.vendorId,
          quantity: line.quantity,
          amount: offering.amount,
          currency: offering.currency,
        };
      }),
    )
  ).filter((line): line is CheckoutLine => line !== undefined);

  if (priced.length === 0) {
    redirect(`/${locale}/cart?checkout=empty`);
  }

  const { outcome, receipt } = await placeOrder(priced);

  if (outcome === 'placed') {
    const jar = await cookies();
    // Only on success, and only after the order is written: a cart cleared
    // before the saga settles loses a basket the buyer may still need if
    // nothing was reserved.
    //
    // ⚠️ The same `path` it was written with. A clear on a different path sets
    // a *second* cookie rather than expiring the first, and the browser keeps
    // sending the original — a cart that empties on screen and comes back on
    // the next request.
    jar.set(CART_COOKIE, '', { path: '/', maxAge: 0 });
    if (receipt) {
      // What the confirmation page renders. `httpOnly`, because nothing in the
      // browser reads it and a receipt is the buyer's, not the page's.
      jar.set(RECEIPT_COOKIE, serializeReceipt(receipt), {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: RECEIPT_TTL_SECONDS,
      });
    }
  }

  // `redirect` throws to unwind the action, so it comes last.
  //
  // A placed order goes to its own page rather than back to the cart: the cart
  // is now empty, and a success banner over an empty-cart state reads like a
  // cancellation. Every other outcome belongs on the cart, which still holds
  // the basket the buyer would retry with.
  redirect(
    outcome === 'placed' && receipt
      ? `/${locale}${storePaths.orderConfirmation()}`
      : `/${locale}/cart?checkout=${outcome}`,
  );
}

/**
 * What a checkout produced: the outcome the buyer is told, and — on success —
 * the receipt the confirmation page renders.
 */
interface CheckoutResult {
  readonly outcome: CheckoutOutcome;
  readonly receipt?: Receipt;
}

/**
 * The order inside a saga result.
 *
 * The coordinator answers with one outcome per step, each carrying the
 * participant's own response body verbatim — so the written order, id and all,
 * is already in hand and nothing needs re-reading. `write-order` is named
 * rather than positional: the step a definition runs last is a property of the
 * definition, and reading the array's end would break the day it grows one.
 */
const orderFromSagaResult = (payload: unknown): Receipt | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const outcomes = (data as { outcomes?: unknown }).outcomes;
  if (!Array.isArray(outcomes)) return undefined;

  const step = outcomes.find(
    (outcome: unknown) =>
      typeof outcome === 'object' &&
      outcome !== null &&
      (outcome as { stepId?: unknown }).stepId === 'write-order',
  ) as { calls?: unknown } | undefined;
  const calls = step?.calls;
  if (!Array.isArray(calls) || calls.length === 0) return undefined;

  const body = (calls[0] as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return undefined;
  const order = (body as { data?: unknown }).data;
  if (typeof order !== 'object' || order === null) return undefined;

  const { id, placedAt, items } = order as {
    id?: unknown;
    placedAt?: unknown;
    items?: unknown;
  };
  if (typeof id !== 'string' || !Array.isArray(items)) return undefined;

  const lines = items.flatMap((item: unknown): ReceiptLine[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { offeringId, quantity, amount, currency } = item as Record<
      string,
      unknown
    >;
    return typeof offeringId === 'string' &&
      typeof quantity === 'number' &&
      typeof amount === 'number' &&
      typeof currency === 'string'
      ? [{ offeringId, quantity, amount, currency }]
      : [];
  });

  return receiptFromOrder(
    id,
    typeof placedAt === 'string' ? placedAt : undefined,
    lines,
  );
};

/**
 * Run the checkout saga.
 *
 * The inputs are keyed by step id, which is the shape the generic engine walks:
 * `reserve` fans out over the lines, `write-order` takes one body.
 */
const placeOrder = async (
  lines: readonly CheckoutLine[],
): Promise<CheckoutResult> => {
  const response = await fetch(`${checkoutServiceUrl()}/saga/checkout`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-crossing-token': sagaCrossingToken(),
    },
    body: JSON.stringify({
      inputs: {
        reserve: lines.map(line => ({
          organizationId: line.vendorId,
          body: {
            meta: { type: 'entity', entity: 'reservation' },
            data: { offeringId: line.offeringId, quantity: line.quantity },
          },
        })),
        'write-order': [
          {
            body: {
              meta: { type: 'entity', entity: 'product-order' },
              data: { items: lines },
            },
          },
        ],
      },
    }),
    // Never cached: this is a write, and a cached checkout is a buyer told
    // their order succeeded because somebody else's did.
    cache: 'no-store',
  }).catch(() => undefined);

  if (!response) return { outcome: 'failed' };
  if (response.status === 201) {
    // ⚠️ A body that will not parse does **not** fail the checkout. The order
    // is written by this point, and telling a buyer their purchase failed
    // because a response could not be read would be a lie with a receipt behind
    // it. They land on the cart's success banner instead, which is where this
    // page stood before there was a confirmation page at all.
    const payload = await response.json().catch(() => undefined);
    const receipt = orderFromSagaResult(payload);
    return receipt ? { outcome: 'placed', receipt } : { outcome: 'placed' };
  }
  // `409` is the saga's own answer for "compensated" — a line was refused and
  // every hold taken has been given back. That is a stock outcome the buyer can
  // act on, not an error to apologise for.
  if (response.status === 409) return { outcome: 'unavailable' };
  return { outcome: 'failed' };
};
