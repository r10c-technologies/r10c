import type { FleetConfiguration } from '@r10c/shells-effect-service';
import { Context, Effect, Layer } from 'effect';

/**
 * How long a delivery flow waits, in milliseconds: for the courier's report,
 * and then for a refused parcel to come back. Configuration rows, group
 * `delivery`, read once at boot and stated into every delivery the
 * coordinator starts — never taken from the caller, which would let whoever
 * starts a delivery decide when it gives up.
 */
export interface DeliveryDials {
  readonly awaitDeliveryMs: number;
  readonly awaitReturnMs: number;
}

export class DeliveryDialsTag extends Context.Service<
  DeliveryDialsTag,
  DeliveryDials
>()('DeliveryDialsTag') {}

/** The configuration group the two windows are rows of. */
export const DELIVERY_DIALS_GROUP = 'delivery';

export const deliveryDialsLayer = ({ store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const group = store.in(DELIVERY_DIALS_GROUP);
    return Layer.succeed(DeliveryDialsTag, {
      awaitDeliveryMs: yield* group.getNumber('awaitDeliveryTimeout'),
      awaitReturnMs: yield* group.getNumber('awaitReturnTimeout'),
    });
  });
