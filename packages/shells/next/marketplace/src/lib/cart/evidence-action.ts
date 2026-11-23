'use server';

import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { orderServiceUrl } from './checkout-config';
import { declaredTypeOf, evidenceOutcomeOf } from './evidence-outcome';
import { readReceiptTicket } from './receipt-cookie';

/**
 * The buyer attaches a payment receipt to one vendor order, by the receipt's
 * own capability and no session (ADR 0081 §6). A plain form post, so it works
 * with scripting off; the file goes on as raw bytes, never base64.
 */
export async function attachPaymentReceipt(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  const orderId = String(formData.get('orderId') ?? '');
  const file = formData.get('receipt');
  const receipt = await readReceiptTicket();
  const back = (outcome: string) =>
    `/${locale}${storePaths.orderStatus(receipt?.groupId ?? '')}?receipt=${outcome}`;

  // Whether the order is this group's is order-service's to decide: it
  // compares the nonce with the digest the group holds.
  if (
    receipt === undefined ||
    orderId === '' ||
    !(file instanceof Blob) ||
    file.size === 0
  ) {
    redirect(back('failed'));
  }

  const response = await fetch(
    `${orderServiceUrl()}/product-order/${encodeURIComponent(
      orderId,
    )}/buyer-payment-evidence`,
    {
      method: 'POST',
      headers: {
        'content-type': declaredTypeOf(file.type),
        'x-cancel-nonce': receipt.cancelNonce,
      },
      body: new Uint8Array(await file.arrayBuffer()),
      cache: 'no-store',
    },
  ).catch(() => undefined);
  const body: unknown = await Promise.resolve()
    .then(() => response?.json())
    .catch(() => undefined);

  redirect(back(evidenceOutcomeOf(response?.status, body)));
}
