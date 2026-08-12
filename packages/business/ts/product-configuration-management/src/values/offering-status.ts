/**
 * The publication lifecycle of a vendor's offering.
 *
 * `draft` → `pending-review` → `published` → `unpublished`. Publication is what
 * projects the offering into the platform-plane `published-catalog` store;
 * unpublication removes the projected record.
 *
 * The state lives on the **tenant-side** offering, not on the projection,
 * because the projection is derived data and is never merged into — republishing
 * replaces it wholesale
 * ([ADR 0009](../../../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 *
 * `pending-review` exists before there is anything to review: operator
 * moderation needs the audited crossing of
 * [ADR 0012](../../../../../docs/adr/0012-operator-cross-tenant-access.md),
 * which v1 does not build. Until then publication is vendor-initiated and the
 * state is reachable but not gating.
 */
export const OfferingStatuses = [
  'draft',
  'pending-review',
  'published',
  'unpublished',
] as const;

export type OfferingStatus = (typeof OfferingStatuses)[number];

/** Narrow an unknown value to an offering status. */
export const isOfferingStatus = (value: unknown): value is OfferingStatus =>
  typeof value === 'string' &&
  (OfferingStatuses as readonly string[]).includes(value);
