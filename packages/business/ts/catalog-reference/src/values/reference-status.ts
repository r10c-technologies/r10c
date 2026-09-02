/**
 * Whether a piece of the shared vocabulary is still offered for classification.
 *
 * `active` → `retired`, and back. Retiring is **not** deleting, and the
 * difference is the whole reason the member exists: a brand or a category is
 * referenced by id from `ProductSpecification` in another slice's store
 * (ADR 0022), where nothing enforces the reference — so removing the row turns
 * every offering classified under it into a dangling id, and the storefront
 * loses a facet it was already showing. Retiring keeps the record resolvable
 * for what already points at it while taking it out of the pickers that would
 * add more.
 *
 * Reversible on purpose. An operator retires a brand the marketplace has
 * stopped carrying and un-retires it when it comes back, and neither direction
 * should require restoring a deleted row.
 *
 * One vocabulary for both entities rather than two identical unions: they are
 * the same lifecycle, they are retired by the same operator on the same screen,
 * and the labels are shared through one `enumLabelKey`.
 */
export const ReferenceStatuses = ['active', 'retired'] as const;

export type ReferenceStatus = (typeof ReferenceStatuses)[number];

/** The state a newly authored record starts in. */
export const DEFAULT_REFERENCE_STATUS: ReferenceStatus = 'active';

/** Narrow an unknown value to a reference status. */
export const isReferenceStatus = (value: unknown): value is ReferenceStatus =>
  typeof value === 'string' &&
  (ReferenceStatuses as readonly string[]).includes(value);
