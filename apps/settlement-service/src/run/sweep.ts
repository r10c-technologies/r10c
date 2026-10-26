import { ShutdownRegistryTag } from '@entifix/business';
import { SettlementRunStoreTag } from '@r10c/business-ts-settlement-management';
import { Context, Duration, Effect, Fiber } from 'effect';

/** How often the sweep looks for unsettled lines, from config-service. */
export class SettlementRunIntervalMs extends Context.Service<
  SettlementRunIntervalMs,
  number
>()('SettlementRunIntervalMs') {}

/**
 * Settle on an interval. A run states the period it actually covered, so
 * changing the cadence does not invalidate what came before; every failure is
 * logged, because an error that escaped `forever` would end the daemon
 * silently.
 */
export const startSettlementSweep = Effect.gen(function* () {
  const runs = yield* SettlementRunStoreTag;
  const interval = yield* SettlementRunIntervalMs;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = runs.settleOnce().pipe(
    Effect.tap(outcome =>
      outcome.kind === 'calculated'
        ? Effect.logInfo('settled a period').pipe(
            Effect.annotateLogs({
              runId: outcome.runId,
              periodStart: outcome.periodStart,
              periodEnd: outcome.periodEnd,
              payouts: outcome.payouts,
              entries: outcome.entries,
            }),
          )
        : Effect.void,
    ),
    Effect.catch(error =>
      Effect.logError('settlement sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

  const daemon = yield* Effect.forkDetach(
    sweepOnce.pipe(Effect.delay(Duration.millis(interval)), Effect.forever),
  );

  yield* shutdown.register({
    name: 'settlement-sweep',
    phase: 'stop-intake',
    run: Fiber.interrupt(daemon).pipe(Effect.asVoid),
  });
});
