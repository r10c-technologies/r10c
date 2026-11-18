import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { cookies } from 'next/headers';

import { runRead } from '../catalog/catalog-reads';
import { readBuyerReceipt } from './receipt-read';
import {
  type Receipt,
  RECEIPT_COOKIE,
  receiptCookieMaxAge,
  receiptFromReadBack,
  serializeReceipt,
} from './receipt-state';

/**
 * The receipt a capability opens, read back from order-service and named with
 * each seller's published name — `undefined` when the read did not answer one.
 * Shared by a settled checkout and a redeemed access link, which both end by
 * holding a fresh nonce for a group (ADR 0076 §6).
 */
export const receiptFor = async (
  groupId: string,
  nonce: string,
): Promise<Receipt | undefined> => {
  const readBack = await readBuyerReceipt(groupId, nonce);
  const vendors = await runRead(PublishedVendor, loadVendors(), []);
  return receiptFromReadBack(
    readBack,
    nonce,
    new Map(vendors.map(vendor => [vendor.vendorId, vendor.displayName])),
  );
};

/**
 * Write the receipt into its `httpOnly` cookie, living exactly as long as the
 * group says the receipt may be read.
 */
export const writeReceiptCookie = async (receipt: Receipt): Promise<void> => {
  (await cookies()).set(RECEIPT_COOKIE, serializeReceipt(receipt), {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: receiptCookieMaxAge(receipt, new Date()),
  });
};
