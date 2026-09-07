import type { OfferingStatus } from './offering-status';

/**
 * The moves a vendor can make on an offering's lifecycle.
 *
 * Two verbs, not four states-worth. `draft` and `pending-review` are where an
 * offering *starts*, not somewhere it is driven to: nothing in v1 moderates,
 * because operator review needs the audited crossing of
 * [ADR 0012](../../../../../docs/adr/0012-operator-cross-tenant-access.md),
 * which is not built. So `pending-review` is reachable and **not gating**, and
 * the only transitions anyone can ask for are these.
 */
export const OfferingTransitions = ['publish', 'unpublish'] as const;

export type OfferingTransition = (typeof OfferingTransitions)[number];

/**
 * The status a transition produces, or `undefined` if the move is illegal.
 *
 * A table rather than a pair of `if`s, because it is the whole rule and it
 * belongs where it can be read at a glance and tested without a repository.
 * The route calls this through the use case; nothing enforces a lifecycle in a
 * handler.
 *
 * Two entries are worth reading twice.
 *
 * **`published → published` is legal.** Republishing is not a no-op and not a
 * mistake: it is how a vendor's edit reaches the storefront, and
 * [ADR 0009](../../../../../docs/adr/0009-catalog-authoring-and-publication.md)
 * specifies that a republication replaces the projection **wholesale** rather
 * than merging into it. Rejecting it as "already published" would leave a
 * corrected price permanently invisible with no error to explain why.
 *
 * **`unpublish` is legal only from `published`.** It is the one genuinely
 * illegal move a person can ask for — taking down something that was never up —
 * and it must fail rather than write `unpublished` over a draft, which would
 * strand the offering in a state its author cannot publish *out* of by any path
 * that reads as forward progress.
 */
const TRANSITIONS: Record<
  OfferingTransition,
  Partial<Record<OfferingStatus, OfferingStatus>>
> = {
  publish: {
    draft: 'published',
    'pending-review': 'published',
    published: 'published',
    unpublished: 'published',
  },
  unpublish: {
    published: 'unpublished',
  },
};

/** The resulting status, or `undefined` when the transition is not allowed. */
export function offeringStatusAfter(
  current: OfferingStatus,
  transition: OfferingTransition,
): OfferingStatus | undefined {
  return TRANSITIONS[transition][current];
}

/** Whether a transition is allowed from a given status. */
export function isLegalOfferingTransition(
  current: OfferingStatus,
  transition: OfferingTransition,
): boolean {
  return offeringStatusAfter(current, transition) !== undefined;
}
