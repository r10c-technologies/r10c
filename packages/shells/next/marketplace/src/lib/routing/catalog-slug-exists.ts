import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { getCategoryByCode } from '@r10c/implementation-catalog-reference-next';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import { Effect } from 'effect';

import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { runRead } from '../catalog/catalog-reads';
import { memoizeSlugLookup } from './catalog-slug';

/**
 * Whether a `/p/` or `/c/` address names a published record, for the
 * storefront's proxy (#346).
 *
 * ⚠️ **Why the proxy asks at all.** Under partial prerendering every route's
 * static shell goes out first, and a status is sent with the first byte — so
 * a page that finds nothing can only render the not-found page under a `200`.
 * The proxy runs before any of that, which makes it the one place a miss can
 * still answer `404`. It asks through the same cells the pages read, and each
 * answer is reused for the catalog's own lifetime, so a product's existence
 * costs one read a minute, not one a visit.
 *
 * A failed read answers `undefined` and the request goes through untouched:
 * an outage must never read as a missing product.
 */
export const catalogSlugExists = memoizeSlugLookup(
  async slug =>
    slug.kind === 'product'
      ? runRead(
          PublishedOffering,
          getOffering(slug.key).pipe(Effect.map(found => found !== undefined)),
          undefined,
        )
      : runRead(
          ProductCategory,
          getCategoryByCode(slug.key).pipe(
            Effect.map(found => found !== undefined),
          ),
          undefined,
        ),
  { ttl: CATALOG_CACHE.revalidate * 1000, max: 5_000 },
);
