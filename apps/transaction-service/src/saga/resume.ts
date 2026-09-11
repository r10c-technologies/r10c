import {
  resumeSaga,
  type SagaDefinition,
  SagaDispatcherTag,
  type SagaInstance,
  type SagaStore,
  SagaStoreTag,
} from '@r10c/entifix-transactions';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { Context, Duration, Effect, Fiber } from 'effect';

import { recordSagaResume, recordStaleSagas } from '../observability/metrics';
import { SAGAS } from '../sagas';

/**
 * How often the sweep looks for instances nobody finished, from config-service.
 *
 * Configuration rather than a constant, for the reason the outbox relay's
 * ceiling is: nothing about it is baked into a broker declaration or an index,
 * so an edit is adopted on the next boot.
 */
export class SagaResumeIntervalMs extends Context.Tag('SagaResumeIntervalMs')<
  SagaResumeIntervalMs,
  number
>() {}

/**
 * How long an instance may sit untouched before a sweep presumes its
 * coordinator is gone.
 *
 * ⚠️ **A separate dial from the interval, and it must stay above the longest a
 * step legitimately takes.** `updatedAt` is re-stamped before every dispatch,
 * so a merely-slow participant keeps the instance fresh — but a step slower
 * than this window would be resumed underneath the coordinator still waiting on
 * it. Both would then dispatch, and only the participants' command inboxes
 * would stop that from being two side effects.
 */
export class SagaStaleAfterMs extends Context.Tag('SagaStaleAfterMs')<
  SagaStaleAfterMs,
  number
>() {}

/**
 * How many sweeps may pick one instance up before it is surfaced instead.
 *
 * The ceiling ADR 0030 gives an outbox entry, on the record that already
 * exists. Past it the instance settles `STRANDED` and is logged at error level,
 * because a coordinator spinning on a permanent failure is how a customer's
 * money stays captured with nobody told.
 */
export class SagaMaxResumeAttempts extends Context.Tag('SagaMaxResumeAttempts')<
  SagaMaxResumeAttempts,
  number
>() {}

/**
 * Resume one claimed instance, reporting rather than propagating a failure.
 *
 * The store is provided **here**, from the value the pass was handed, so the
 * pass requires only the dispatcher from context. Taking a store as an argument
 * and then also resolving one from a tag would be two ways to name one
 * dependency, and a spec could satisfy one while the code used the other.
 */
const resumeOne = (
  store: SagaStore,
  instance: SagaInstance,
  definition: SagaDefinition,
  maxResumeAttempts: number,
) =>
  resumeSaga({ instance, definition, maxResumeAttempts }).pipe(
    Effect.provideService(SagaStoreTag, store),
    Effect.tap(result => recordSagaResume(result.state)),
    Effect.tap(result =>
      Effect.logInfo('resumed a saga instance').pipe(
        Effect.annotateLogs({
          sagaId: instance.sagaId,
          definition: instance.definition,
          resumedFrom: instance.state,
          stepIndex: instance.stepIndex,
          settled: result.state,
        }),
      ),
    ),
    Effect.asVoid,
    // Per instance, so one flow that cannot be resumed does not abandon every
    // flow behind it in the same pass.
    Effect.catchAll(error =>
      Effect.logError('resuming a saga instance failed').pipe(
        Effect.annotateLogs({
          sagaId: instance.sagaId,
          error: String(error),
        }),
      ),
    ),
  );

/**
 * One pass: find the instances nobody finished, claim each, and finish it.
 *
 * ⚠️ **Exported as a pass, and forked separately below.** A pass is assertable
 * and a daemon on an interval is not — the same split `sweepStale` makes.
 *
 * ⚠️ **`findStale` then `claimForResume`, never `findStale` then resume.** The
 * claim is a conditional write that re-stamps `updatedAt`, so an instance
 * another replica already took no longer matches and is skipped here. Without
 * it two sweepers would walk one flow together, and the attempt ceiling would
 * count two attempts per tick.
 */
export const resumeStaleSagas = (
  store: SagaStore,
  sagas: Readonly<Record<string, SagaDefinition>>,
  staleAfterMs: number,
  maxResumeAttempts: number,
) =>
  Effect.gen(function* () {
    const stale = yield* store.findStale(staleAfterMs);
    yield* recordStaleSagas(stale.length);

    for (const found of stale) {
      const definition = sagas[found.definition];
      if (!definition) {
        // The instance names a flow this process does not know. Nothing here can
        // finish it, and settling it would be a guess about steps we cannot
        // read — so it is surfaced and left alone.
        yield* Effect.logError('stale saga names an unknown definition').pipe(
          Effect.annotateLogs({
            sagaId: found.sagaId,
            definition: found.definition,
          }),
        );
        continue;
      }

      const claimed = yield* store.claimForResume(found.sagaId, staleAfterMs);
      if (claimed === undefined) {
        continue;
      }

      yield* resumeOne(store, claimed, definition, maxResumeAttempts);
    }
  }).pipe(
    // Around the whole pass as well as around each instance: a `findStale` that
    // cannot reach Mongo must not kill the daemon, or the fleet silently stops
    // resuming anything until someone restarts the process.
    Effect.catchAll(error =>
      Effect.logError('saga resume sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

/**
 * Fork the sweep as a detached daemon so it outlives the boot effect.
 *
 * `stop-intake` rather than `flush`: this sweep both writes Mongo and dispatches
 * HTTP, so it has to stop before the client it writes through does — the same
 * phase, and the same reason, as the recovery sweep beside it.
 */
export const startSagaResume = Effect.gen(function* () {
  const store = yield* SagaStoreTag;
  const interval = yield* SagaResumeIntervalMs;
  const staleAfterMs = yield* SagaStaleAfterMs;
  const maxResumeAttempts = yield* SagaMaxResumeAttempts;
  const shutdown = yield* ShutdownRegistryTag;
  const dispatcher = yield* SagaDispatcherTag;

  // The dispatcher is closed over at boot rather than resolved per tick; the
  // store travels as a value into the pass.
  const sweepOnce = resumeStaleSagas(
    store,
    SAGAS,
    staleAfterMs,
    maxResumeAttempts,
  ).pipe(Effect.provideService(SagaDispatcherTag, dispatcher));

  const daemon = yield* Effect.forkDaemon(
    sweepOnce.pipe(Effect.delay(Duration.millis(interval)), Effect.forever),
  );

  yield* shutdown.register({
    name: 'saga-resume-sweep',
    phase: 'stop-intake',
    run: Fiber.interrupt(daemon).pipe(Effect.asVoid),
  });
});
