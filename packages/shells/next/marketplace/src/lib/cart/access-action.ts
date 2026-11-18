'use server';

import { createHash, randomBytes } from 'node:crypto';

import { redirect } from 'next/navigation';

import { storePaths } from '../routing/paths';
import { redeemedGroup } from './access-redemption';
import { orderServiceUrl } from './checkout-config';
import { receiptFor, writeReceiptCookie } from './receipt-write';

/**
 * Redeem a mailed one-time access link (ADR 0076 §6): mint a fresh nonce, as a
 * checkout does, and send the link's token and the nonce's digest to
 * order-service, which swaps the digest in for the group's capability and
 * spends the link. Then read the receipt back by the new nonce, write it into
 * this browser's receipt cookie, and open it. The browser that held the old
 * nonce stops reading the order — whoever controls the mailbox controls the
 * receipt.
 *
 * Reached only by a post from the access page's button: a mail scanner that
 * fetches the link spends nothing.
 */
export async function redeemAccessLink(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  const token = String(formData.get('token') ?? '');
  const refused = `/${locale}${storePaths.orderAccess({ failed: '1' })}`;
  if (token === '') redirect(refused);

  const nonce = randomBytes(32).toString('hex');
  const response = await fetch(`${orderServiceUrl()}/checkout-group/access`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      capabilityDigest: createHash('sha256')
        .update(nonce, 'utf8')
        .digest('hex'),
    }),
    cache: 'no-store',
  }).catch(() => undefined);
  const body: unknown = response?.ok
    ? await response.json().catch(() => undefined)
    : undefined;
  const groupId = redeemedGroup(body);
  if (groupId === undefined) redirect(refused);

  const receipt = await receiptFor(groupId, nonce);
  if (receipt !== undefined) await writeReceiptCookie(receipt);
  redirect(`/${locale}${storePaths.orderStatus(groupId)}`);
}
