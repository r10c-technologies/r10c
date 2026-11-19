import { ShutdownRegistryTag } from '@entifix/business';
import {
  expireOverduePayments,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber, Schedule } from 'effect';

/**
 * One pass of the payment-expiry sweep (ADR 0081 §4): every payment-link order
 * still waiting past its window is cancelled by one conditional write, which a
 * seller's confirmation landing first wins instead. Each cancellation is
 * announced as `order.cancelled`, which the checkout flow waiting on that
 * order hears and lets its stock go. Logged here, because this is the fork
 * site (ADR 0064). Never fails — the daemon around it must not end, and a
 * failed pass leaves its orders to the next one.
 */
export const sweepOverduePayments = Effect.gen(function* () {
  const expired = yield* expireOverduePayments(new Date());
  if (expired > 0) {
    yield* logSliceOutcome('Debug', 'expired unpaid link orders', {
      expired,
    });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'payment expiry sweep failed', {}, failure),
  ),
);

/** Fork the sweep on `intervalMs`, once at boot and then on the interval. */
export const startPaymentExpirySweep = (intervalMs: number) =>
  Effect.gen(function* () {
    const orders = yield* ProductOrderStoreTag;
    const shutdown = yield* ShutdownRegistryTag;

    const sweepOnce = sweepOverduePayments.pipe(
      Effect.provideService(ProductOrderStoreTag, orders),
    );

    const daemon = yield* Effect.forkDetach(
      sweepOnce.pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(intervalMs))),
      ),
    );

    // `flush`, so it stops after the handlers have: an expiry racing a live
    // confirmation is decided at the store either way, but a write nobody
    // waits on should not outlive the process's drain.
    yield* shutdown.register({
      name: 'payment-expiry-sweep',
      phase: 'flush',
      run: Fiber.interrupt(daemon),
    });
  });
