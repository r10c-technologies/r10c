import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  EmptyState,
  Skeleton,
  Stack,
  StatusTag,
  SubmitButton,
} from '@entifix/react-controls/primitives';
import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadBrands } from '@r10c/implementation-catalog-reference-next';
import {
  getVariantCounts,
  offeringCard,
} from '@r10c/implementation-marketplace-catalog-next';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { ProductCard } from '@r10c/utils-react-ui';

import { addToCart } from '../cart/cart-actions';
import { imageHosts, imageLoaderFor } from '../media/image-hosts';
import { storePaths } from '../routing/paths';
import { emptyPage, runReadOutcome } from './catalog-reads';
import { priceBasisLabel } from './price-basis';

/**
 * The names a grid's cards carry beside the offering itself: each brand's, and
 * each seller's (ADR 0061). Both live in other stores, so they are read **once
 * for the whole page** rather than per card.
 */
export interface CardNames {
  readonly brandName: (brandId: string) => string | undefined;
  readonly sellerName: (vendorId: string) => string | undefined;
  /**
   * Whether the seller ships, read in the same call as the name: a card from
   * a seller who does not offers no Add, as their product page does not
   * (ADR 0076 §8). `undefined` when the seller could not be read.
   */
  readonly ships: (vendorId: string) => boolean | undefined;
  /**
   * How many published variants a group holds, read once for the page
   * (ADR 0085 §7); `undefined` for no group, or when the count failed.
   */
  readonly variantCount: (variantGroup: string) => number | undefined;
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
  const vendorIds = Array.from(
    new Set(offerings.map(offering => offering.vendorId)),
  );
  const [brands, vendors, variants] = await Promise.all([
    runReadOutcome(ProductBrand, loadBrands(), emptyPage<ProductBrand>()),
    runReadOutcome(PublishedVendor, loadVendors(vendorIds), []),
    runReadOutcome(
      PublishedOffering,
      getVariantCounts(offerings),
      new Map<string, number>(),
    ),
  ]);
  const brandNames = new Map(
    brands.value.items.map(brand => [String(brand.id), brand.name]),
  );
  const sellerNames = new Map(
    vendors.value.map(vendor => [vendor.vendorId, vendor.displayName]),
  );
  const shipping = new Map(
    vendors.value.map(vendor => [vendor.vendorId, vendor.acceptsCod]),
  );
  return {
    brandName: id => brandNames.get(id),
    sellerName: id => sellerNames.get(id),
    ships: id => shipping.get(id),
    variantCount: group => variants.value.get(group),
    failed: brands.failed || vendors.failed || variants.failed,
  };
}

/**
 * How the grid lays its cards out (#569).
 *
 * - **`strip`**: a fixed count of cards (home's strips, the related strip) in
 *   fixed columns, two below `lg` and four from it, so four cards always fill
 *   whole rows and the last is never an orphan that reads as a failed load.
 * - **`listing`**: a page of results, as many columns as fit. A full search
 *   page (24) divides by two, three and four, so it never orphans either.
 */
/**
 * What a card says about its product beyond its own price: that it is a kit
 * (ADR 0086), or how many versions it comes in (ADR 0085 §7). Nothing for a
 * plain offering, so the card draws no row.
 */
export const cardChips = (
  offering: PublishedOffering,
  names: Pick<CardNames, 'variantCount'>,
  labels: {
    readonly kit: string;
    readonly variants: (count: number) => string;
  },
) => {
  const count =
    offering.variantGroup === undefined
      ? undefined
      : names.variantCount(offering.variantGroup);
  const chips = [
    ...((offering.kitSize ?? 0) > 0 ? [labels.kit] : []),
    ...(count !== undefined && count > 1 ? [labels.variants(count)] : []),
  ];
  return chips.length === 0
    ? undefined
    : chips.map(chip => (
        <StatusTag key={chip} tone="neutral">
          {chip}
        </StatusTag>
      ));
};

export type OfferingGridLayout = 'strip' | 'listing';

export interface OfferingGridProps {
  readonly locale: Locale;
  readonly layout: OfferingGridLayout;
  /**
   * What sets this grid's cards apart from every other grid on the page, so
   * each card's title id is unique: `<idScope>-<offeringId>`. Required,
   * because two grids rendered in separate cached passes cannot share
   * `useId`'s counter (#726).
   */
  readonly idScope: string;
  readonly offerings: readonly PublishedOffering[];
  /** What `loadCardNames` read for these offerings. */
  readonly names: CardNames;
  /**
   * The listing's own address, locale-prefixed with its query, where a card's
   * add sends the buyer back to (#574). Absent, the add lands on the cart.
   */
  readonly returnTo?: string;
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
  layout,
  idScope,
  offerings,
  names,
  returnTo,
  emptyLabel,
}: OfferingGridProps) {
  if (offerings.length === 0) {
    return <EmptyState>{emptyLabel}</EmptyState>;
  }

  const t = getServerTFor(locale, 'r10c');
  const priceBasis = priceBasisLabel(
    // i18next 27's `TFunction` is not assignable to a plain translate
    // signature, so the label gets the call it declares.
    (key, values) => (values ? t(key, values) : t(key)),
    locale,
  );
  const hosts = imageHosts();

  return (
    <div className={GRID[layout]}>
      {offerings.map((offering, index) => {
        const card = offeringCard(offering, {
          locale,
          brandName: names.brandName,
          sellerName: names.sellerName,
          priceBasis,
          soldBy: seller => t('storefront.product.soldBy', { seller }),
          labels: {
            available: t('storefront.product.available'),
            unavailable: t('storefront.product.unavailable'),
          },
        });
        return (
          <ProductCard
            chips={cardChips(offering, names, {
              kit: t('storefront.product.kit.chip'),
              variants: count =>
                t('storefront.product.variantCount', { count }),
            })}
            key={offering.offeringId}
            titleId={`${idScope}-${offering.offeringId}-title`}
            href={localeHref(locale, storePaths.offering(offering.offeringId))}
            {...card}
            // At the size the card shows it, through the optimizer when its
            // host allows (#571).
            media={
              card.media === undefined
                ? undefined
                : {
                    // Named, not spread: a snapshot's media is a class whose
                    // members are accessors, which a spread leaves behind.
                    url: card.media.url,
                    alt: card.media.alt,
                    sizes: SIZES[layout],
                    loader: imageLoaderFor(card.media.url, hosts),
                    // A listing's first row is what a phone paints largest:
                    // its pictures are fetched first (#566).
                    priority: layout === 'listing' && index < PRIORITY_CARDS,
                  }
            }
            // One action, and it is not a client component. The card itself is
            // the link to the product (#568); "Add" is a form posting to the
            // same Server Action the product page uses, with `SubmitButton`, a
            // server component: entifix's `Button` is `'use client'`, and one
            // per tile is a client boundary per tile.
            //
            // Its visible word is short, and its name says what it adds, with
            // the visible word inside it (WCAG 2.5.3). It is the card's primary
            // target, so it takes the 44px floor at the card's full width.
            cta={
              names.ships(offering.vendorId) === false ? undefined : (
                <form action={addToCart}>
                  <input
                    type="hidden"
                    name="offeringId"
                    value={offering.offeringId}
                  />
                  <input type="hidden" name="locale" value={locale} />
                  {returnTo === undefined ? null : (
                    <input type="hidden" name="returnTo" value={returnTo} />
                  )}
                  <SubmitButton
                    variant="primary"
                    size="sm"
                    className="touch-target w-full"
                    aria-label={t('storefront.product.addNamed', {
                      name: offering.name,
                    })}
                  >
                    {t('storefront.product.add')}
                  </SubmitButton>
                </form>
              )
            }
          />
        );
      })}
    </div>
  );
}

/**
 * How wide a card's picture is shown in each layout, as `sizes`: half the
 * viewport in two columns, then a strip's quarter of the 80rem frame or a
 * listing's column beside its filters.
 */
/** A listing's first row on a phone: two cards. */
const PRIORITY_CARDS = 2;

const SIZES: Record<OfferingGridLayout, string> = {
  strip: '(min-width: 64rem) 20rem, 50vw',
  listing: '(min-width: 40rem) 24rem, 50vw',
};

/**
 * Two to a row on a phone in both layouts, where one card per row is a screen
 * per product (#568). A layout and not a density mode: the buyer chooses
 * nothing (ADR 0075).
 */
const GRID: Record<OfferingGridLayout, string> = {
  strip: 'grid grid-cols-2 gap-s sm:gap-l lg:grid-cols-4',
  listing:
    'grid grid-cols-2 gap-s sm:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] sm:gap-l',
};

/**
 * What a streaming route flushes while the grid is still resolving. Same `Grid`
 * and same aspect ratio as the real thing, so the shell does not reflow when
 * the offerings arrive.
 */
export function OfferingGridSkeleton({
  layout,
  count = 6,
}: {
  readonly layout: OfferingGridLayout;
  readonly count?: number;
}) {
  return (
    <div className={GRID[layout]}>
      {Array.from({ length: count }, (_, index) => (
        // The card's own container rule, so a narrow placeholder is square
        // exactly where the card that replaces it is.
        <div key={index} className="@container">
          <Stack gap="s">
            <Skeleton
              shape="block"
              className="aspect-video w-full @max-[13rem]:aspect-square"
            />
            <Skeleton shape="line" className="w-2/3" />
            <Skeleton shape="line" className="w-full" />
          </Stack>
        </div>
      ))}
    </div>
  );
}
