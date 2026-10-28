import { ShutdownRegistryTag } from '@entifix/business';
import { StockLedgerTag } from '@r10c/business-ts-stock-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber } from 'effect';

const SWEEP_INTERVAL = Duration.seconds(30);

/**
 * The reaper: without it `expiresAt` is a timestamp nothing reads, and every
 * abandoned basket promises a vendor's stock permanently (ADR 0010, #227).
 * The ledger walks every organization's store; this only keeps it walking.
 *
 * A failed pass is **logged**, never fatal and never swallowed: a reaper that
 * stays dead while every probe stays green is stock promised to checkouts
 * nobody finished. The next pass retries whatever is still expired.
 */
/**
 * One pass, logged here because this is the fork site (ADR 0064): each hold the
 * ledger could not release, by its code and category, and a pass that could
 * not run at all. Never fails — the daemon around it must not end.
 */
export const sweepExpiredHolds = Effect.gen(function* () {
  const ledger = yield* StockLedgerTag;
  const sweep = yield* ledger.releaseExpired();
  for (const { database, reservationId, failure } of sweep.failed) {
    yield* logSliceOutcome(
      'Error',
      'expiring a reservation failed',
      { database, reservationId },
      failure,
    );
  }
  if (sweep.released > 0) {
    yield* logSliceOutcome('Debug', 'released expired reservations', {
      released: sweep.released,
    });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'reservation sweep failed', {}, failure),
  ),
);

export const startReservationSweep = Effect.gen(function* () {
  const ledger = yield* StockLedgerTag;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = sweepExpiredHolds.pipe(
    Effect.provideService(StockLedgerTag, ledger),
  );

  const daemon = yield* Effect.forkDetach(
    sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
  );

  // `flush`, so it runs after the handlers have stopped: a sweep racing a live
  // conversion would keep finding holds that handler is still transitioning.
  yield* shutdown.register({
    name: 'reservation-sweep',
    phase: 'flush',
    run: Fiber.interrupt(daemon),
  });
});
