import type { EnumTone } from '@entifix/core';

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

/**
 * A status read at a glance: a live offering succeeds, one waiting on review
 * warns, and a draft or a withdrawn one is neutral. A value with no tone reads neutral.
 */
export const OfferingStatusTones = {
  'pending-review': 'warning',
  published: 'success',
} as const satisfies Readonly<Partial<Record<OfferingStatus, EnumTone>>>;

/** Narrow an unknown value to an offering status. */
/**
 * The statuses of an offering that was never on sale. Its unit can still
 * change (ADR 0082 §3): nothing was quoted, carted or stocked against it in
 * the storefront's eyes. Once published it is fixed for good, and an
 * unpublished offering is one that was published.
 */
export const NeverPublishedStatuses = [
  'draft',
  'pending-review',
] as const satisfies readonly OfferingStatus[];

export const isNeverPublished = (status: OfferingStatus): boolean =>
  (NeverPublishedStatuses as readonly OfferingStatus[]).includes(status);

export const isOfferingStatus = (value: unknown): value is OfferingStatus =>
  typeof value === 'string' &&
  (OfferingStatuses as readonly string[]).includes(value);

/**
 * The statuses an offering may be deleted from: one not on sale. A published
 * offering is unpublished first — deleting it would leave its projection
 * selling a record nobody can retract, since a delete announces nothing.
 */
export const DeletableOfferingStatuses = [
  ...NeverPublishedStatuses,
  'unpublished',
] as const satisfies readonly OfferingStatus[];
