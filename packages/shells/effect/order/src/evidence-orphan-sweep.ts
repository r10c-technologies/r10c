import { ShutdownRegistryTag } from '@entifix/business';
import { ObjectStoreTag } from '@r10c/business-ts-object-storage';
import {
  ProductOrderStoreTag,
  sweepOrphanEvidence,
} from '@r10c/business-ts-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber, Schedule } from 'effect';

/**
 * How old a receipt file must be before no record pointing at it makes it an
 * orphan (ADR 0081 §6): a day, so a file whose attach is still writing its
 * record is never swept from under it.
 */
export const ORPHAN_GRACE_MS = Duration.toMillis(Duration.days(1));

/**
 * One pass of the orphan sweep: every receipt file older than the grace that
 * no order points at is deleted — what an attach that crashed between its
 * write and its record left, or a delete the redaction sweep could not
 * finish. Logged here, because this is the fork site (ADR 0064). Never fails.
 */
export const sweepOrphans = Effect.gen(function* () {
  const deleted = yield* sweepOrphanEvidence(new Date(), ORPHAN_GRACE_MS);
  if (deleted > 0) {
    yield* logSliceOutcome('Debug', 'deleted orphan receipt files', {
      deleted,
    });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'orphan receipt sweep failed', {}, failure),
  ),
);

/** Fork the sweep on `intervalMs`, once at boot and then on the interval. */
export const startEvidenceOrphanSweep = (intervalMs: number) =>
  Effect.gen(function* () {
    const orders = yield* ProductOrderStoreTag;
    const objects = yield* ObjectStoreTag;
    const shutdown = yield* ShutdownRegistryTag;

    const sweepOnce = sweepOrphans.pipe(
      Effect.provideService(ProductOrderStoreTag, orders),
      Effect.provideService(ObjectStoreTag, objects),
    );

    const daemon = yield* Effect.forkDetach(
      sweepOnce.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(intervalMs))),
      ),
    );

    yield* shutdown.register({
      name: 'evidence-orphan-sweep',
      phase: 'flush',
      run: Fiber.interrupt(daemon),
    });
  });
