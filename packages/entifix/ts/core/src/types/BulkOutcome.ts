import type { EntityId } from './Entity';

/**
 * What happened to **one** row of a bulk action.
 *
 * Partial failure is the normal case, not an edge one: 40 rows selected, 3
 * refused. A single success/failure result for the whole run lies in both
 * directions — reported as a failure it hides the 37 that were written, and
 * reported as a success it hides the 3 that were not, which is the worse half
 * because the user walks away believing the work is done.
 *
 * `code` is an **error code**, never a sentence. Services answer
 * `{ error, code, detail }` and the browser renders the code through the
 * `errors` catalog, so a failure reason stays translatable and a new one fails
 * `@r10c/i18n-check` rather than reaching a user in English
 * ([docs/I18N.md](../../../../../../docs/I18N.md)).
 */
export interface BulkOutcome {
  id: EntityId;
  ok: boolean;
  /** Present only when `ok` is false. */
  code?: string;
}

/** The ids that failed — what a retry re-runs, and nothing else. */
export function failedIds(outcomes: readonly BulkOutcome[]): EntityId[] {
  return outcomes.filter(outcome => !outcome.ok).map(outcome => outcome.id);
}

/** How many rows were written. */
export function succeededCount(outcomes: readonly BulkOutcome[]): number {
  return outcomes.filter(outcome => outcome.ok).length;
}
