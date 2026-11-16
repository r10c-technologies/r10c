import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  ButtonLink,
  Cluster,
  EmptyState,
  Grid,
  Skeleton,
  Stack,
  SubmitButton,
} from '@entifix/react-controls/primitives';
import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadBrands } from '@r10c/implementation-catalog-reference-next';
import { offeringCard } from '@r10c/implementation-marketplace-catalog-next';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { ProductCard } from '@r10c/utils-react-ui';

import { addToCart } from '../cart/cart-actions';
import { storePaths } from '../routing/paths';
import { emptyPage, runReadOutcome } from './catalog-reads';

/**
 * The names a grid's cards carry beside the offering itself: each brand's, and
 * each seller's (ADR 0061). Both live in other stores, so they are read **once
 * for the whole page** rather than per card.
 */
export interface CardNames {
  readonly brandName: (brandId: string) => string | undefined;
  readonly sellerName: (vendorId: string) => string | undefined;
  /**
   * Whether either read failed. A grid without seller lines is still a grid,
   * so a failure never drops a card; but the cached component that rendered it
   * keeps that render for seconds rather than the catalog's lifetime, exactly
   * as it does for a failed offering read (#533).
   */
  readonly failed: boolean;
}

/**
 * Reads the brands and the sellers of `offerings`, in parallel.
 *
 * The caller awaits it inside its own `'use cache'` scope, so the failure can
 * decide that scope's `cacheLife` — a `cacheLife` called from a child
 * component would not be the caller's one decision.
 */
export async function loadCardNames(
  offerings: readonly PublishedOffering[],
): Promise<CardNames> {
  const vendorIds = [...new Set(offerings.map(offering => offering.vendorId))];
  const [brands, vendors] = await Promise.all([
    runReadOutcome(ProductBrand, loadBrands(), emptyPage<ProductBrand>()),
    runReadOutcome(PublishedVendor, loadVendors(vendorIds), []),
  ]);
  const brandNames = new Map(
    brands.value.items.map(brand => [String(brand.id), brand.name]),
  );
  const sellerNames = new Map(
    vendors.value.map(vendor => [vendor.vendorId, vendor.displayName]),
  );
  return {
    brandName: id => brandNames.get(id),
    sellerName: id => sellerNames.get(id),
    failed: brands.failed || vendors.failed,
  };
}

export interface OfferingGridProps {
  readonly locale: Locale;
  readonly offerings: readonly PublishedOffering[];
  /** What `loadCardNames` read for these offerings. */
  readonly names: CardNames;
  readonly emptyLabel: string;
}

/**
 * A grid of offerings, named through `names`, which the caller read once for
 * the whole page. Taking them rather than reading them keeps the grid free of
 * data access, so the read's failure stays the caller's to cache by.
 *
 * Each offering is mapped onto `ProductCard`'s roles by the catalog cell's
 * `offeringCard`. What stays here is the call to action, because where a card
 * leads is the page's decision.
 */
export function OfferingGrid({
  locale,
  offerings,
  names,
  emptyLabel,
}: OfferingGridProps) {
  if (offerings.length === 0) {
    return <EmptyState>{emptyLabel}</EmptyState>;
  }

  const t = getServerTFor(locale, 'r10c');

  return (
    <Grid min="18rem" gap="l">
      {offerings.map(offering => (
        <ProductCard
          key={offering.offeringId}
          {...offeringCard(offering, {
            locale,
            brandName: names.brandName,
            sellerName: names.sellerName,
            soldBy: seller => t('storefront.product.soldBy', { seller }),
            labels: {
              available: t('storefront.product.available'),
              unavailable: t('storefront.product.unavailable'),
            },
          })}
          // Two actions, and neither is a client component. "View product"
          // navigates, so it is a `ButtonLink`. "Add to cart" is a form posting
          // to the same Server Action the product page uses, with
          // `SubmitButton`, a server component: entifix's `Button` is
          // `'use client'`, and one per tile is a client boundary per tile.
          cta={
            <Cluster gap="2xs">
              <form action={addToCart}>
                <input
                  type="hidden"
                  name="offeringId"
                  value={offering.offeringId}
                />
                <input type="hidden" name="locale" value={locale} />
                <SubmitButton variant="primary" size="sm">
                  {t('storefront.product.addToCart')}
                </SubmitButton>
              </form>
              <ButtonLink
                href={localeHref(
                  locale,
                  storePaths.offering(offering.offeringId),
                )}
                variant="secondary"
                size="sm"
              >
                {t('storefront.product.view')}
              </ButtonLink>
            </Cluster>
          }
        />
      ))}
    </Grid>
  );
}

/**
 * What a streaming route flushes while the grid is still resolving. Same `Grid`
 * and same aspect ratio as the real thing, so the shell does not reflow when
 * the offerings arrive.
 */
export function OfferingGridSkeleton({
  count = 6,
}: {
  readonly count?: number;
}) {
  return (
    <Grid min="18rem" gap="l">
      {Array.from({ length: count }, (_, index) => (
        <Stack key={index} gap="s">
          <Skeleton shape="block" className="aspect-video w-full" />
          <Skeleton shape="line" className="w-2/3" />
          <Skeleton shape="line" className="w-full" />
        </Stack>
      ))}
    </Grid>
  );
}
