'use server';

import { createHash, randomBytes } from 'node:crypto';

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
/**
 * Mint the secret that authorizes this buyer's own cancel.
 *
 * ⚠️ **The storefront mints it, and the order stores only its digest.** The
 * obvious design has order-service mint a signed token and hand it back in the
 * `201` — and that `201` *is* the saga's `write-order` outcome, persisted in the
 * `saga` store and served whole by `GET /api/saga/:id` to any principal whose
 * organization appears among the flow's calls, which is every vendor in this
 * basket. A bearer token there would let one vendor cancel a multi-vendor order
 * their own session is refused with `409`. A digest is inert, so the digest is
 * what travels ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * 32 bytes from `randomBytes`, which is why the server may store an unsalted
 * SHA-256 of it: there is no dictionary to iterate over 256 bits of randomness.
 */
const mintCancelCapability = (): {
  readonly nonce: string;
  readonly digest: string;
} => {
  const nonce = randomBytes(32).toString('hex');
  return {
    nonce,
    digest: createHash('sha256').update(nonce, 'utf8').digest('hex'),
  };
};

const orderFromSagaResult = (
  payload: unknown,
  cancelNonce: string,
): Receipt | undefined => {
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

  const { id, placedAt, items, cancelWindowEndsAt } = order as {
    id?: unknown;
    placedAt?: unknown;
    items?: unknown;
    cancelWindowEndsAt?: unknown;
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
    // ⚠️ The nonce rides along **only** when the server answered with a window
    // it stamped. A nonce with no window is a secret that opens nothing, and
    // carrying it would put a Cancel button on a page whose request must fail.
    typeof cancelWindowEndsAt === 'string'
      ? { cancelNonce, cancelWindowEndsAt }
      : undefined,
  );
};

/**
 * The currency a basket is priced in. One today, and named rather than inlined
 * so the day it is not, the places that assume it are greppable.
 */
const STOREFRONT_CURRENCY = 'GTQ';

/**
 * Run the checkout saga.
 *
 * The inputs are keyed by step id, which is the shape the generic engine walks:
 * `reserve` fans out over the lines, `write-order` takes one body, and
 * `capture-payment` takes one whose `orderId` is a **template**.
 *
 * ⚠️ **`{steps.write-order.data.id}` is not a placeholder this code fills in.**
 * order-service mints the order id, so it does not exist when this request is
 * built; the engine resolves it from the step's recorded outcome before
 * dispatching the capture. Sending a literal instead is the defect measured on
 * the live lab — a payment attached to nothing, and an order that never leaves
 * `pending` because the event announcing its capture names an order that is not
 * there ([ADR 0054](../../../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 *
 * ⚠️ **`convert-reservation` takes no input at all.** Its cardinality and its
 * addresses both come from the holds `reserve` actually took, which is what
 * `fanOutFrom` means — a caller supplying them could convert a hold it never
 * took, or, far more likely, convert none.
 */
const placeOrder = async (
  lines: readonly CheckoutLine[],
): Promise<CheckoutResult> => {
  // ⚠️ **One pass, and the seed currency is not a fallback that can be hit.**
  // Every line overwrites it, and `checkout` redirects an empty basket before
  // reaching here — so the seed exists to give the fold a type rather than to
  // stand in for a missing value. Written as `lines[0]?.currency ?? …` instead,
  // it would be an unreachable branch that reads like a guarded default.
  const totals = lines.reduce(
    (accumulated, line) => ({
      amount: accumulated.amount + line.amount * line.quantity,
      currency: line.currency,
    }),
    { amount: 0, currency: STOREFRONT_CURRENCY },
  );

  const capability = mintCancelCapability();

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
              // The digest, never the nonce — see `mintCancelCapability`. The
              // server stamps the window from it and owns both timestamps.
              data: { items: lines, cancelDigest: capability.digest },
            },
          },
        ],
        'capture-payment': [
          {
            body: {
              meta: { type: 'entity', entity: 'payment' },
              data: {
                orderId: '{steps.write-order.data.id}',
                amount: totals.amount,
                currency: totals.currency,
                paymentMethod: 'card',
              },
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
    const receipt = orderFromSagaResult(payload, capability.nonce);
    return receipt ? { outcome: 'placed', receipt } : { outcome: 'placed' };
  }
  // `409` is the saga's own answer for "compensated" — a line was refused and
  // every hold taken has been given back. That is a stock outcome the buyer can
  // act on, not an error to apologise for.
  if (response.status === 409) return { outcome: 'unavailable' };
  return { outcome: 'failed' };
};
