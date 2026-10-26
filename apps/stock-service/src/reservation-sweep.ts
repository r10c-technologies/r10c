import { ShutdownRegistryTag } from '@entifix/business';
import { StockLedgerTag } from '@r10c/business-ts-stock-management';
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
export const startReservationSweep = Effect.gen(function* () {
  const ledger = yield* StockLedgerTag;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = ledger
    .releaseExpired()
    .pipe(
      Effect.catch(error =>
        Effect.logError('reservation sweep failed').pipe(
          Effect.annotateLogs({ error: String(error) }),
        ),
      ),
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
