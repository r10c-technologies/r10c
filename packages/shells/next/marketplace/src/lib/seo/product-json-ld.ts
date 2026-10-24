import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';

export interface ProductJsonLdInput {
  readonly offering: PublishedOffering;
  /** The product page's absolute URL. */
  readonly url: string;
  readonly brandName?: string;
  readonly sellerName?: string;
}

/**
 * The schema.org `Product` a product page states for search engines.
 *
 * Built only from what the snapshot carries, and every optional member stays
 * absent rather than empty, as on the page: a `brand` with no name is a claim
 * with nothing in it. The price is the published one in major units, which is
 * what `Offer.price` means. Availability is the projection's hint, the same
 * one the page shows (ADR 0010): a crawler is told no more than a buyer is.
 */
export const productJsonLd = ({
  offering,
  url,
  brandName,
  sellerName,
}: ProductJsonLdInput): Record<string, unknown> => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: offering.name,
  ...(offering.description ? { description: offering.description } : {}),
  ...(offering.code ? { sku: offering.code } : {}),
  ...(offering.media && offering.media.length > 0
    ? { image: offering.media.map(picture => picture.url) }
    : {}),
  ...(brandName ? { brand: { '@type': 'Brand', name: brandName } } : {}),
  offers: {
    '@type': 'Offer',
    url,
    price: (offering.amount / 100).toFixed(2),
    priceCurrency: offering.currency,
    availability: offering.availableHint
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    ...(sellerName
      ? { seller: { '@type': 'Organization', name: sellerName } }
      : {}),
  },
});

/**
 * The JSON for an inline `<script type="application/ld+json">`.
 *
 * ⚠️ **`<` is escaped, and that is the security boundary.** Every string here
 * was authored by a vendor, and a product named `</script><script>…` would
 * otherwise close the tag and run in every visitor's browser. `<` is the
 * same character to a JSON parser and no character at all to the HTML one.
 */
export const jsonLdScript = (value: Record<string, unknown>): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');
