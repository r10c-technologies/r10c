import { ShutdownRegistryTag } from '@entifix/business';
import {
  applyCourierReports,
  CourierTrackingTag,
  ShippingOrderStoreTag,
} from '@r10c/business-ts-shipping-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Duration, Effect, Fiber, Schedule } from 'effect';

/**
 * How often the courier feed is asked about the parcels in transit. A
 * delivery a person records arrives sooner; this only saves the click.
 */
const FEED_INTERVAL = Duration.seconds(30);

/**
 * One pass of the courier feed (ADR 0081 §11). Logged here, because this is
 * the fork site (ADR 0064). Never fails — the daemon around it must not end.
 */
export const pollCourierFeed = Effect.suspend(() =>
  applyCourierReports(new Date()),
).pipe(
  Effect.flatMap(applied =>
    applied > 0
      ? logSliceOutcome('Debug', 'applied courier reports', { applied })
      : Effect.void,
  ),
  Effect.catch(failure =>
    logSliceOutcome('Error', 'courier feed failed', {}, failure),
  ),
);

/**
 * Start the courier feed's daemon: once at boot, then on the interval, until
 * the service flushes. Each pass asks with a fresh `now`.
 */
export const startCourierFeed = Effect.gen(function* () {
  const shipments = yield* ShippingOrderStoreTag;
  const tracking = yield* CourierTrackingTag;
  const shutdown = yield* ShutdownRegistryTag;

  const pollOnce = pollCourierFeed.pipe(
    Effect.provideService(ShippingOrderStoreTag, shipments),
    Effect.provideService(CourierTrackingTag, tracking),
  );

  const daemon = yield* Effect.forkDetach(
    pollOnce.pipe(Effect.repeat(Schedule.spaced(FEED_INTERVAL))),
  );

  // `flush`, so it stops after the handlers have.
  yield* shutdown.register({
    name: 'courier-feed',
    phase: 'flush',
    run: Fiber.interrupt(daemon),
  });
});
