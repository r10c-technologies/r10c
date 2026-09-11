'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { orderServiceUrl } from './checkout-config';
import { readReceipt } from './receipt-cookie';
import {
  RECEIPT_COOKIE,
  RECEIPT_TTL_SECONDS,
  serializeReceipt,
} from './receipt-state';

/** What the confirmation page is told happened, as a search param. */
export type CancelOutcome = 'cancelled' | 'failed';

/**
 * Cancel the order this browser holds a receipt for.
 *
 * ⚠️ **The order id comes from the cookie, never from the form.** A hidden input
 * naming the order would be a field the browser's owner can edit, and the nonce
 * they hold authorizes exactly one order — so reading both from the same place
 * keeps them a pair rather than two values that might disagree.
 *
 * ⚠️ **No token, and no session.** The nonce in the receipt is the whole
 * authority: order-service stores its SHA-256 digest and compares against that.
 * It is read here and never reaches the browser, which `'use server'`
 * guarantees, and the cookie it lives in is `httpOnly` so no script can read it
 * either ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md) §5).
 *
 * ⚠️ **On success the receipt is rewritten rather than cleared.** The page reads
 * nothing back — the storefront holds no session and order-service's reads take
 * one — so the cookie *is* the page's state. Clearing it would replace a
 * cancelled order with the "there is no order to show" screen, which reads as
 * the cancel having lost the receipt.
 */
export async function cancelOrder(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  const receipt = await readReceipt();

  if (!receipt?.cancelNonce) {
    // No capability to present. The page does not render the button in this
    // state, so arriving here means the receipt lapsed between the render and
    // the submit.
    redirect(`/${locale}/order/confirmation?cancel=failed`);
  }

  const response = await fetch(
    `${orderServiceUrl()}/product-order/${encodeURIComponent(
      receipt.orderId,
    )}/buyer-cancellation`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cancelNonce: receipt.cancelNonce }),
      cache: 'no-store',
    },
  ).catch(() => undefined);

  if (response?.ok) {
    const jar = await cookies();
    // The capability is spent, so it is dropped from the cookie: a nonce that
    // opens nothing is a Cancel button the page would have to explain. What
    // stays is the receipt itself, now marked cancelled.
    const {
      cancelNonce: _spent,
      cancelWindowEndsAt: _closed,
      ...rest
    } = receipt;
    jar.set(RECEIPT_COOKIE, serializeReceipt({ ...rest, cancelled: true }), {
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: RECEIPT_TTL_SECONDS,
    });
    redirect(`/${locale}/order/confirmation?cancel=cancelled`);
  }

  // `redirect` throws to unwind the action, so it comes last on every path.
  redirect(`/${locale}/order/confirmation?cancel=failed`);
}
