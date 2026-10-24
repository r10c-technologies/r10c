import type { Locale } from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { formatPrice, type ProductCardProps } from '@r10c/utils-react-ui';

/** The roles an offering fills. The call to action is the page's to choose. */
export type OfferingCardRoles = Pick<
  ProductCardProps,
  'title' | 'price' | 'brand' | 'description' | 'media' | 'availability'
>;

export interface OfferingCardContext {
  readonly locale: Locale;
  /**
   * A brand's name by its id. The names are `catalog-reference`'s vocabulary,
   * another domain's store, so the shell reads them once for the whole grid
   * and hands this over.
   */
  readonly brandName: (brandId: string) => string | undefined;
  /** The availability copy, already translated. */
  readonly labels: {
    readonly available: string;
    readonly unavailable: string;
  };
}

/**
 * One published offering mapped onto `ProductCard`'s roles.
 *
 * Every role reads a member by name, so renaming a member of `PublishedOffering`
 * fails the build here rather than leaving a card with a blank role. A member
 * the snapshot left absent leaves its role absent too, and the card draws
 * nothing for it.
 */
export const offeringCard = (
  offering: PublishedOffering,
  { locale, brandName, labels }: OfferingCardContext,
): OfferingCardRoles => ({
  title: offering.name,
  price: formatPrice(locale, offering.amount, offering.currency),
  brand:
    offering.brandId === undefined ? undefined : brandName(offering.brandId),
  description: offering.description,
  // The first picture is the card's; the rest are the product page's gallery.
  media: offering.media?.[0],
  // A hint, and the name says so: published data is eventually consistent on
  // purpose, and the checkout reservation is the truth (ADR 0009).
  availability: offering.availableHint ? labels.available : labels.unavailable,
});
