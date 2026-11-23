import type { Locale } from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import type { ProductCardProps } from '@r10c/utils-react-ui';

/** The roles an offering fills. The call to action is the page's to choose. */
export type OfferingCardRoles = Pick<
  ProductCardProps,
  | 'title'
  | 'price'
  | 'unitPrice'
  | 'brand'
  | 'seller'
  | 'description'
  | 'media'
  | 'availability'
>;

export interface OfferingCardContext {
  readonly locale: Locale;
  /**
   * A brand's name by its id. The names are `catalog-reference`'s vocabulary,
   * another domain's store, so the shell reads them once for the whole grid
   * and hands this over.
   */
  readonly brandName: (brandId: string) => string | undefined;
  /**
   * A seller's display name by its vendor id. It is the `published-vendor`
   * projection's (ADR 0061), read once for the whole grid like the brands.
   * A miss is `undefined`, and the card then draws no seller line: an absent
   * line is honest, a raw id is not.
   */
  readonly sellerName: (vendorId: string) => string | undefined;
  /**
   * What the price buys, already worded ("por 100 u."), or `undefined` for one
   * piece. A price quoted per hundred read as a price each is a hundred times
   * too cheap (ADR 0082 §5).
   */
  readonly priceBasis: (offering: PublishedOffering) => string | undefined;
  /** "Sold by {{seller}}", already translated. */
  readonly soldBy: (seller: string) => string;
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
  {
    locale,
    brandName,
    sellerName,
    priceBasis,
    soldBy,
    labels,
  }: OfferingCardContext,
): OfferingCardRoles => {
  const seller = sellerName(offering.vendorId);
  return {
    title: offering.name,
    // Minor units, as the snapshot carries them; the card's `Money` formats it.
    price: { amount: offering.amount, currency: offering.currency, locale },
    unitPrice: priceBasis(offering),
    brand:
      offering.brandId === undefined ? undefined : brandName(offering.brandId),
    seller: seller === undefined ? undefined : soldBy(seller),
    description: offering.description,
    // The first picture is the card's; the rest are the product page's gallery.
    media: offering.media?.[0],
    // A hint, and the name says so: published data is eventually consistent on
    // purpose, and the checkout reservation is the truth (ADR 0009).
    availability: offering.availableHint
      ? { label: labels.available, available: true }
      : { label: labels.unavailable, available: false },
  };
};
