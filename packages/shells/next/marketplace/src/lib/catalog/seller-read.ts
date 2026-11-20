import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { getVendor } from '@r10c/implementation-marketplace-vendor-next';
import { cacheLife } from 'next/cache';

import { CATALOG_CACHE } from './catalog-cache';
import { runRead } from './catalog-reads';

/** What the page states about its seller, as a cache entry may hold it. */
export interface SellerFound {
  readonly vendorId: string;
  readonly name: string;
  readonly whatsappNumber?: string;
}

/**
 * The seller a vendor id names, as plain data, or `undefined` for one nobody
 * announced. A failed read reads as `undefined` too; the proxy has already
 * answered `404` for a seller it knows is missing, and let an outage through.
 */
export async function findSeller(
  vendorId: string,
): Promise<SellerFound | undefined> {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const vendor = await runRead(PublishedVendor, getVendor(vendorId), undefined);
  if (vendor === undefined) return undefined;
  return {
    vendorId: vendor.vendorId,
    name: vendor.displayName,
    ...(vendor.whatsappNumber ? { whatsappNumber: vendor.whatsappNumber } : {}),
  };
}
