import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { BulkOutcome, Entity, EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import type { ReferenceStatus } from '../../values/reference-status';

/** A record of the shared vocabulary, as far as retiring is concerned. */
export interface RetirableReference extends Entity {
  status: ReferenceStatus;
}

/** The rows to retire, and which way. */
export interface RetireReferenceInput {
  readonly ids: readonly EntityId[];
  /** `false` puts the rows back into circulation. */
  readonly retired: boolean;
}

export class RetireReferenceInputTag extends Context.Tag(
  'RetireReferenceInputTag',
)<RetireReferenceInputTag, RetireReferenceInput>() {}

/**
 * The failure codes a single row can produce.
 *
 * They are **codes, not sentences** — the browser renders them through the
 * shared `errors` catalog, and `@r10c/i18n-check` fails the build on one the
 * catalog lacks. `alreadyRetired` is the honest per-row failure that makes
 * partial reporting worth building: an operator selects forty brands, three of
 * them were retired last month, and a run that reported plain success would
 * leave them believing it had acted on all forty.
 */
export const RETIRE_ALREADY = 'alreadyRetired';
export const RETIRE_NOT_FOUND = 'notFound';

/**
 * Retire (or restore) a set of reference records, reporting **per row**.
 *
 * The shape is the point. A bulk verb that fails as a whole is a worse
 * primitive than N single calls: one bad id would roll back thirty-nine good
 * writes, and the operator learns only that "it failed". So each row is
 * attempted independently and each produces its own {@link BulkOutcome}, and
 * the effect itself does not fail — a failed *row* is data, not an error.
 *
 * Deliberately **not** one transaction. These rows have no invariant between
 * them: retiring Sony neither depends on nor constrains retiring Philips, so
 * atomicity would only convert a partial success into a total failure. The
 * write is a sequence of independent single-record saves in one store, which is
 * also why this needs no saga.
 *
 * Framework-free, like every use case here: the repository arrives as a tag,
 * the caller has already been authorized by the route, and nothing about HTTP
 * or the selection's wire shape reaches this far — an id list is an id list
 * whether it came from ticked boxes or from a filter the service resolved.
 */
export const retireReferences = Effect.gen(function* () {
  const { ids, retired } = yield* RetireReferenceInputTag;
  const repository = yield* EntityRepositoryTag;

  const outcomes: BulkOutcome[] = [];

  for (const id of ids) {
    const outcome = yield* Effect.gen(function* () {
      const record = yield* repository.get<RetirableReference>(id);
      const target: ReferenceStatus = retired ? 'retired' : 'active';

      // Already in the requested state: reported as a failure rather than a
      // silent no-op, because the operator asked for something that did not
      // happen and a count of forty successes would be a lie about three of
      // them. It is not an *error* — the run continues.
      if (record.status === target) {
        return { id, ok: false, code: RETIRE_ALREADY } satisfies BulkOutcome;
      }

      record.status = target;
      yield* repository.save(record);
      return { id, ok: true } satisfies BulkOutcome;
    }).pipe(
      // A row that could not be read at all — deleted between the listing and
      // the action, most often. One row's failure never ends the run.
      Effect.catchAll(() =>
        Effect.succeed({
          id,
          ok: false,
          code: RETIRE_NOT_FOUND,
        } satisfies BulkOutcome),
      ),
    );

    outcomes.push(outcome);
  }

  return outcomes;
});
