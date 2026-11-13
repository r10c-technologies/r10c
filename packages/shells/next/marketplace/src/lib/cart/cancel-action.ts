'use server';

import {
  type ConfirmActionState,
  whenConfirmed,
} from '@entifix/next-shell/server';
import {
  digestFlowCapability,
  makeFlowCapability,
} from '@entifix/transactions';
import { Effect } from 'effect';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { cancelStartOf } from './cancel-outcome';
import {
  CANCEL_COOKIE,
  CANCEL_TTL_SECONDS,
  serializeCancelTicket,
} from './cancel-ticket';
import { orderServiceUrl } from './checkout-config';
import { readReceipt } from './receipt-cookie';

/**
 * The buyer cancelling **one vendor order** from their receipt, with the
 * group's capability and no session (ADR 0069): the other sellers' orders in
 * the checkout are untouched. The nonce stays on the receipt, because it still
 * opens the orders not cancelled.
 *
 * A cancellation is a flow (ADR 0066): order-service answers `202` and the
 * receipt follows it to its end, by a flow capability this action mints and
 * keeps in an `httpOnly` ticket. The receipt marks the order cancelled only
 * once the flow completed.
 *
 * ⚠️ It acts only on a confirmed post (`whenConfirmed`). Cancelling refunds,
 * and a refund is not undone, so a post that skipped the confirmation — a
 * first click with scripting off, a stale page, a script — is answered with
 * the confirmation step instead (a3-2, ADR 0075).
 */
export async function cancelOrder(
  _state: ConfirmActionState,
  formData: FormData,
): Promise<ConfirmActionState> {
  return whenConfirmed(formData, () => cancelConfirmed(formData));
}

async function cancelConfirmed(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const receipt = await readReceipt();
  const back = (outcome?: string) =>
    `/${locale}${storePaths.orderStatus(receipt?.groupId ?? '')}${
      outcome === undefined ? '' : `?cancel=${outcome}`
    }`;

  const order = receipt?.orders.find(entry => entry.orderId === orderId);
  if (!receipt?.cancelNonce || order === undefined) {
    // No capability to present, or an order this receipt does not name. The
    // page renders no button in either state, so arriving here means the
    // receipt lapsed between the render and the submit.
    redirect(back('failed'));
  }

  const capability = await Effect.runPromise(makeFlowCapability());
  const response = await fetch(
    `${orderServiceUrl()}/product-order/${encodeURIComponent(
      order.orderId,
    )}/buyer-cancellation`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // An RFC 9651 String. A fresh one per click: the claim, not the key,
        // is what makes a second cancellation of one order move nothing.
        'idempotency-key': `"${globalThis.crypto.randomUUID()}"`,
      },
      body: JSON.stringify({
        cancelNonce: receipt.cancelNonce,
        capabilityDigest: await Effect.runPromise(
          digestFlowCapability(capability.nonce),
        ),
      }),
      cache: 'no-store',
    },
  ).catch(() => undefined);

  const payload: unknown = await Promise.resolve()
    .then(() => response?.json())
    .catch(() => undefined);
  const start = cancelStartOf(response?.status, payload);

  if (start.kind === 'started') {
    (await cookies()).set(
      CANCEL_COOKIE,
      serializeCancelTicket({
        flowId: start.flowId,
        capability: capability.nonce,
        orderId,
      }),
      {
        path: '/',
        sameSite: 'lax',
        httpOnly: true,
        maxAge: CANCEL_TTL_SECONDS,
      },
    );
  }

  // `redirect` throws to unwind the action, so it comes last on every path.
  redirect(back(start.kind === 'started' ? undefined : start.kind));
}
