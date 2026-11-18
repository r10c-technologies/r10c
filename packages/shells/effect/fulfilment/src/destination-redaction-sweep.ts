import { ShutdownRegistryTag } from '@entifix/business';
import { ShippingOrderStoreTag } from '@r10c/business-ts-shipping-order-management';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Context, Duration, Effect, Fiber } from 'effect';

/**
 * How many days a shipment keeps its destination after its journey ends —
 * delivered, returned or withdrawn — from config-service
 * (`fulfilment.destinationRetentionDays`). A product choice, not a courier
 * term (ADR 0076 §4).
 */
export class DestinationRetentionDays extends Context.Service<
  DestinationRetentionDays,
  number
>()('DestinationRetentionDays') {}

/** How often the sweep looks: the dial is in days, so an hour late is nothing. */
const SWEEP_INTERVAL = Duration.hours(1);

const DAY_MS = 86_400_000;

/**
 * One pass of the destination retention sweep, across every organization's
 * `fulfilment` store. Logged here, because this is the fork site (ADR 0064):
 * each shipment it could not redact, and a pass that could not run at all.
 * Never fails — the daemon around it must not end.
 */
export const sweepClosedDestinations = Effect.gen(function* () {
  const shipments = yield* ShippingOrderStoreTag;
  const days = yield* DestinationRetentionDays;
  const now = new Date();
  const sweep = yield* shipments.redactClosedBefore(
    new Date(now.getTime() - days * DAY_MS),
    now,
  );
  for (const { database, shippingOrderId, failure } of sweep.failed) {
    yield* logSliceOutcome(
      'Error',
      'removing a destination failed',
      { database, shippingOrderId },
      failure,
    );
  }
  if (sweep.redacted > 0) {
    yield* logSliceOutcome('Debug', 'removed shipment destinations', {
      redacted: sweep.redacted,
    });
  }
}).pipe(
  Effect.catch(failure =>
    logSliceOutcome('Error', 'destination sweep failed', {}, failure),
  ),
);

export const startDestinationRedactionSweep = Effect.gen(function* () {
  const shipments = yield* ShippingOrderStoreTag;
  const days = yield* DestinationRetentionDays;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = sweepClosedDestinations.pipe(
    Effect.provideService(ShippingOrderStoreTag, shipments),
    Effect.provideService(DestinationRetentionDays, days),
  );

  const daemon = yield* Effect.forkDetach(
    sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
  );

  // `flush`, so it stops after the handlers have.
  yield* shutdown.register({
    name: 'destination-redaction-sweep',
    phase: 'flush',
    run: Fiber.interrupt(daemon),
  });
});
