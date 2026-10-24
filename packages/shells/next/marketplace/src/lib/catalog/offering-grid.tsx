import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  button,
  ButtonLink,
  Cluster,
  Grid,
  Skeleton,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { loadBrands } from '@r10c/implementation-catalog-reference-next';
import { offeringCard } from '@r10c/implementation-marketplace-catalog-next';
import { ProductCard } from '@r10c/utils-react-ui';

import { addToCart } from '../cart/cart-actions';
import { storePaths } from '../routing/paths';
import { emptyPage, runRead } from './catalog-reads';

export interface OfferingGridProps {
  readonly locale: Locale;
  readonly offerings: readonly PublishedOffering[];
  readonly emptyLabel: string;
}

/**
 * A grid of offerings, with brand names resolved **once for the whole page**.
 *
 * Per card it would be one request per tile for a value the vocabulary is small
 * enough to hold entirely — and the reads are sequential inside a server
 * component, so a nine-tile grid would be nine round trips before the first
 * byte. Resolving here also keeps the card free of any data access, which is
 * what lets it be asserted without a backend.
 *
 * Each offering is mapped onto `ProductCard`'s roles by the catalog cell's
 * `offeringCard`. What stays here is the call to action, because where a card
 * leads is the page's decision.
 */
export async function OfferingGrid({
  locale,
  offerings,
  emptyLabel,
}: OfferingGridProps) {
  if (offerings.length === 0) {
    return <Text muted>{emptyLabel}</Text>;
  }

  const brands = await runRead(
    ProductBrand,
    loadBrands(),
    emptyPage<ProductBrand>(),
  );
  const nameOf = new Map(
    brands.items.map(brand => [String(brand.id), brand.name]),
  );

  const t = getServerTFor(locale, 'r10c');

  return (
    <Grid min="18rem" gap="l">
      {offerings.map(offering => (
        <ProductCard
          key={offering.offeringId}
          {...offeringCard(offering, {
            locale,
            brandName: id => nameOf.get(id),
            labels: {
              available: t('storefront.product.available'),
              unavailable: t('storefront.product.unavailable'),
            },
          })}
          // Two actions, and neither is a client component. "View product"
          // navigates, so it is a `ButtonLink`. "Add to cart" is a form posting
          // to the same Server Action the product page uses, with a plain
          // `<button>` wearing the button recipe: entifix's `Button` is
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
                <button
                  type="submit"
                  className={button({ variant: 'primary', size: 'sm' })}
                >
                  {t('storefront.product.addToCart')}
                </button>
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
