import type { ReferenceLabelRegistration } from '@entifix/business';
import {
  DeviceModel,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  ProductOffering,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';

import { createClientAdapters } from './adapters/create-client-adapters';

const adapters = createClientAdapters();

/**
 * The names this shell can read for a reference on any back-office screen
 * (entifix 0030): the catalog's offerings and specifications through
 * `/api/admin`, and the vocabulary and the sellers' names through
 * `/api/marketplace`.
 *
 * Exported for the host to list, never for another shell to import (ADR 0077):
 * a stock item's `offeringId` is named through this shell's adapter because the
 * host registered it, not because the stock shell reached in here.
 *
 * Vendors are named from the `published-vendor` projection rather than the
 * control-plane `Organization`: it is platform plane, readable by an operator
 * and a vendor alike, and its `id` **is** the organization id, so a `vendorId`
 * resolves directly (ADR 0007, ADR 0061).
 *
 * Module-level and built from the module-level adapters, because the host's
 * registry wants a stable list: a fresh one would rebuild it and refetch.
 */
export const CATALOG_REFERENCE_LABELS: readonly ReferenceLabelRegistration[] = [
  [ProductOffering, adapters.productOfferingRest],
  [ProductSpecification, adapters.productRest],
  [ProductBrand, adapters.productBrandRest],
  [ProductCategory, adapters.productCategoryRest],
  [DeviceModel, adapters.deviceModelRest],
  [PublishedVendor, adapters.publishedVendorRest],
];
