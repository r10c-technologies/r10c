/**
 * Where a sale originates.
 *
 * TM Forum's name for the concept, and the reason there is no second order
 * entity for an in-store sale: TMF622's `ProductOrder` carries a
 * `RelatedChannel` rather than forking by origin, and TMF676's `Payment` does
 * the same. A counter sale is the same order through a different channel
 * ([ADR 0024](../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * The set is **closed**, and that is load-bearing rather than tidy: an
 * `Agreement` carries a commission rate per channel type, so settlement reads
 * this vocabulary to decide what the platform takes. A free-form channel type
 * makes "which rate applies to this line?" unanswerable by query, and an
 * unmatched type would have to fall back to some default rate nobody agreed to.
 *
 * `external` is the escape hatch for a sale captured somewhere the platform does
 * not run — a vendor's own webshop, a third-party marketplace — imported for
 * settlement rather than placed here.
 */
export const SalesChannelTypes = [
  'storefront',
  'counter',
  'phone',
  'external',
] as const;

export type SalesChannelType = (typeof SalesChannelTypes)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a type. */
export const isSalesChannelType = (value: unknown): value is SalesChannelType =>
  typeof value === 'string' &&
  (SalesChannelTypes as readonly string[]).includes(value);
