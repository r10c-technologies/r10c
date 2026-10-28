import { EventSourceTag } from '@entifix/transactions';
import { rebuildEveryPublication } from '@r10c/business-ts-product-configuration-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/**
 * ADR 0050's rebuild walk, logged here because this is the fork site
 * (ADR 0064): each organization it re-announced, each one it could not, and a
 * directory it could not read. Never fails — a walk that failed the boot would
 * take the catalog's writes down with the storefront's reads.
 */
export const rebuildAndReport = (source: string) =>
  rebuildEveryPublication(source).pipe(
    Effect.flatMap(walk =>
      Effect.gen(function* () {
        for (const { organizationId, report } of walk.rebuilt) {
          yield* logSliceOutcome('Info', 'rebuilt a tenant catalog', {
            organizationId,
            ...report,
          });
        }
        for (const { organizationId, failure } of walk.failed) {
          yield* logSliceOutcome(
            'Error',
            'rebuilding a tenant catalog failed',
            { organizationId },
            failure,
          );
        }
      }),
    ),
    Effect.catch(failure =>
      logSliceOutcome(
        'Error',
        'the catalog rebuild could not enumerate tenants',
        {},
        failure,
      ),
    ),
  );

/**
 * The walk on its own fiber, as this slice's source: the boot does not wait
 * for every organization to be re-announced before it serves.
 */
export const startRebuildWalk = Effect.flatMap(EventSourceTag, source =>
  Effect.forkDetach(rebuildAndReport(source)),
);
