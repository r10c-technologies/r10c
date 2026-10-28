import { ShutdownRegistryTag } from '@entifix/business';
import { SettlementRunStoreTag } from '@r10c/business-ts-settlement-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
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
/**
 * One settlement pass, logged here because this is the fork site (ADR 0064):
 * a period it settled, and a pass that failed by its code and category — never
 * its text. Never fails, so the daemon around it cannot end.
 */
export const settleOncePass = Effect.gen(function* () {
  const runs = yield* SettlementRunStoreTag;
  const outcome = yield* runs.settleOnce();
  if (outcome.kind === 'calculated') {
    yield* logSliceOutcome('Info', 'settled a period', {
      runId: outcome.runId,
      periodStart: outcome.periodStart,
      periodEnd: outcome.periodEnd,
      payouts: outcome.payouts,
      entries: outcome.entries,
    });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'settlement sweep failed', {}, failure),
  ),
);

export const startSettlementSweep = Effect.gen(function* () {
  const runs = yield* SettlementRunStoreTag;
  const interval = yield* SettlementRunIntervalMs;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = settleOncePass.pipe(
    Effect.provideService(SettlementRunStoreTag, runs),
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
