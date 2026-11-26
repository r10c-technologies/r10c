import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { getBrand } from '@r10c/implementation-catalog-reference-next';
import {
  getOffering,
  getVariantSiblings,
} from '@r10c/implementation-marketplace-catalog-next';
import { getVendor } from '@r10c/implementation-marketplace-vendor-next';
import { cache } from 'react';

import { runRead } from './catalog-reads';

/** One product and the names its page states beside it. */
export interface ProductRead {
  readonly offering: PublishedOffering;
  readonly brandName?: string;
  /** Absent when nothing was announced for the vendor (ADR 0061). */
  readonly sellerName?: string;
  /**
   * Whether the seller ships, and so takes cash on delivery: one entitlement
   * decides both today (`PublishedVendor.acceptsCod`, ADR 0076 §8). Absent
   * when the vendor could not be read, so the page states nothing and the
   * checkout decides.
   */
  readonly ships?: boolean;
  /** Whether the seller is a sample store with illustrative prices (#676). */
  readonly sampleStore?: boolean;
  /**
   * The product's published variants, this offering included (ADR 0085) —
   * empty for an offering that is no variant, or when they could not be read,
   * which leaves the picker off rather than the page.
   */
  readonly siblings: readonly PublishedOffering[];
}

/**
 * A product page's reads, once per request.
 *
 * `cache` is what lets the page, its `generateMetadata` and its JSON-LD all
 * ask without asking three times: React memoizes the call for the length of
 * one server render. The brand and the seller are another domain's vocabulary
 * each, read through their own cells (ADR 0022), and either one missing
 * leaves its line off rather than the page.
 */
export const readProduct = cache(
  async (offeringId: string): Promise<ProductRead | undefined> => {
    const offering = await runRead(
      PublishedOffering,
      getOffering(offeringId),
      undefined,
    );
    if (offering === undefined) return undefined;

    const [brand, vendor, siblings] = await Promise.all([
      runRead(ProductBrand, getBrand(offering.brandId), undefined),
      runRead(PublishedVendor, getVendor(offering.vendorId), undefined),
      runRead(PublishedOffering, getVariantSiblings(offering), []),
    ]);
    return {
      offering,
      siblings,
      ...(brand ? { brandName: brand.name } : {}),
      ...(vendor
        ? {
            sellerName: vendor.displayName,
            ships: vendor.acceptsCod,
            sampleStore: vendor.sampleStore,
          }
        : {}),
    };
  },
);
