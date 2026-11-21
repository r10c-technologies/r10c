import { ShutdownRegistryTag } from '@entifix/business';
import { ObjectStoreTag } from '@r10c/business-ts-object-storage';
import {
  CheckoutGroupStoreTag,
  ProductOrderStoreTag,
  redactEndedReceipts,
} from '@r10c/business-ts-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber, Schedule } from 'effect';

/**
 * How often the sweep looks. A receipt window is counted in days, so an hour
 * late is nothing, and a pass that finds nothing costs one indexed read.
 */
const SWEEP_INTERVAL = Duration.hours(1);

/**
 * One pass of the buyer-contact retention sweep (ADR 0076 §4): every group
 * whose receipt window has ended and whose orders are all fulfilled or
 * cancelled loses the buyer's contact, and its orders their payment receipt
 * files (ADR 0081 §9). Logged here, because this is the fork
 * site (ADR 0064). Never fails — the daemon around it must not end, and a
 * failed pass leaves its groups to the next one.
 */
export const sweepEndedReceipts = Effect.gen(function* () {
  const redacted = yield* redactEndedReceipts(new Date());
  if (redacted > 0) {
    yield* logSliceOutcome('Debug', 'removed buyer contacts', { redacted });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'buyer contact sweep failed', {}, failure),
  ),
);

export const startReceiptRedactionSweep = Effect.gen(function* () {
  const groups = yield* CheckoutGroupStoreTag;
  const orders = yield* ProductOrderStoreTag;
  const objects = yield* ObjectStoreTag;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = sweepEndedReceipts.pipe(
    Effect.provideService(CheckoutGroupStoreTag, groups),
    Effect.provideService(ProductOrderStoreTag, orders),
    Effect.provideService(ObjectStoreTag, objects),
  );

  // Once at boot, then on the interval: a service restarted more often than
  // the interval would otherwise never sweep at all.
  const daemon = yield* Effect.forkDetach(
    sweepOnce.pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL))),
  );

  // `flush`, so it stops after the handlers have: a redaction racing a live
  // write to the same group would be a write nobody is waiting on.
  yield* shutdown.register({
    name: 'receipt-redaction-sweep',
    phase: 'flush',
    run: Fiber.interrupt(daemon),
  });
});
