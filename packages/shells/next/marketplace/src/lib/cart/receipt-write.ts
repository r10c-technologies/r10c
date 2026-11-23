import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { cookies } from 'next/headers';

import { runRead } from '../catalog/catalog-reads';
import { readBuyerReceiptAnswer } from './receipt-read';
import {
  type Receipt,
  RECEIPT_COOKIE,
  receiptCookieMaxAge,
  receiptFromReadBack,
  type ReceiptTicket,
  serializeTicket,
} from './receipt-state';

/**
 * What a receipt's capability opens on order-service, read on every render:
 * the receipt and the raw answer the page reads its details from, a refusal
 * (`401` — an access link re-keyed the group elsewhere, ADR 0076 §6), or no
 * receipt — nothing answered, or what answered was not one.
 */
export type ReceiptRead =
  | { readonly kind: 'read'; readonly receipt: Receipt; readonly body: unknown }
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' };

/**
 * The receipt a capability opens, read back from order-service and named with
 * each seller's published name. Shared by a settled checkout, a redeemed
 * access link and every render of the receipt page.
 */
export const readReceipt = async (
  ticket: Pick<ReceiptTicket, 'groupId' | 'cancelNonce'>,
): Promise<ReceiptRead> => {
  const answer = await readBuyerReceiptAnswer(
    ticket.groupId,
    ticket.cancelNonce,
  );
  if (answer.kind !== 'read') return answer;
  const vendors = await runRead(PublishedVendor, loadVendors(), []);
  const receipt = receiptFromReadBack(
    answer.body,
    ticket,
    new Map(vendors.map(vendor => [vendor.vendorId, vendor.displayName])),
  );
  return receipt === undefined
    ? { kind: 'failed' }
    : { kind: 'read', receipt, body: answer.body };
};

/**
 * Write the receipt's ticket into its `httpOnly` cookie, living exactly as
 * long as the group says the receipt may be read.
 */
export const writeReceiptCookie = async (
  ticket: ReceiptTicket,
): Promise<void> => {
  (await cookies()).set(RECEIPT_COOKIE, serializeTicket(ticket), {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: receiptCookieMaxAge(ticket, new Date()),
  });
};
