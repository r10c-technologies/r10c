'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { cancelOutcomeOf } from './cancel-outcome';
import { orderServiceUrl } from './checkout-config';
import { readReceipt } from './receipt-cookie';
import {
  RECEIPT_COOKIE,
  RECEIPT_TTL_SECONDS,
  serializeReceipt,
  withCancelled,
} from './receipt-state';

/**
 * The buyer cancelling **one vendor order** from their receipt, with the
 * group's capability and no session (ADR 0069): the other sellers' orders in
 * the checkout are untouched. The nonce stays on the receipt, because it still
 * opens the orders not cancelled.
 */
export async function cancelOrder(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const receipt = await readReceipt();
  const back = (outcome: string) =>
    `/${locale}${storePaths.orderStatus(receipt?.groupId ?? '')}?cancel=${outcome}`;

  const order = receipt?.orders.find(entry => entry.orderId === orderId);
  if (!receipt?.cancelNonce || order === undefined) {
    // No capability to present, or an order this receipt does not name. The
    // page renders no button in either state, so arriving here means the
    // receipt lapsed between the render and the submit.
    redirect(back('failed'));
  }

  const response = await fetch(
    `${orderServiceUrl()}/product-order/${encodeURIComponent(
      order.orderId,
    )}/buyer-cancellation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cancelNonce: receipt.cancelNonce }),
      cache: 'no-store',
    },
  ).catch(() => undefined);

  const code: unknown =
    response?.status === 409
      ? (
          (await response.json().catch(() => undefined)) as
            { code?: unknown } | undefined
        )?.code
      : undefined;
  const outcome = cancelOutcomeOf(response?.status, code);

  if (outcome === 'cancelled') {
    const jar = await cookies();
    jar.set(RECEIPT_COOKIE, serializeReceipt(withCancelled(receipt, orderId)), {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: RECEIPT_TTL_SECONDS,
    });
  }

  // `redirect` throws to unwind the action, so it comes last on every path.
  redirect(back(outcome));
}
