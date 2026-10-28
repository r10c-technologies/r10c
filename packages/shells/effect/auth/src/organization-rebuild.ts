import { MongoDatabaseTag } from '@entifix/mongo';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import { rebuildOrganizationAnnouncements } from '@r10c/implementation-auth-mongo';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

/**
 * Re-announce every organization, logged here because this is the fork site
 * (ADR 0064): what the walk did, an organization it could not announce, and a
 * walk that could not run. Never fails — the projection stays as it was, and
 * the next boot repairs it.
 */
export const rebuildAndReport = Effect.gen(function* () {
  const db = yield* MongoDatabaseTag;
  const bus = yield* EventBusTag;
  const source = yield* EventSourceTag;
  const report = yield* rebuildOrganizationAnnouncements(db, bus, source);
  if (report.unannounceable > 0) {
    yield* logSliceOutcome('Warn', 'organizations cannot be announced', {
      unannounceable: report.unannounceable,
    });
  }
  yield* logSliceOutcome('Info', 're-announced the organizations', {
    ...report,
  });
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome(
      'Error',
      're-announcing the organizations failed',
      {},
      failure,
    ),
  ),
);

/** The walk on its own fiber, so a slow store delays nothing at boot. */
export const startOrganizationRebuild = Effect.forkDetach(rebuildAndReport);
