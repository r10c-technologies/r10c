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

/**
 * How long a payment-link order waits for its seller's confirmation, and the
 * grace either side of it, in milliseconds — configuration rows, group
 * `checkout`, stated into every checkout the coordinator starts (ADR 0081 §3).
 */
export interface PaymentDials {
  readonly paymentWindowMs: number;
  readonly paymentGraceMs: number;
}

export class PaymentDialsTag extends Context.Service<
  PaymentDialsTag,
  PaymentDials
>()('PaymentDialsTag') {}

/** The configuration group the payment window is a row of. */
export const PAYMENT_DIALS_GROUP = 'checkout';

export const paymentDialsLayer = ({ store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const group = store.in(PAYMENT_DIALS_GROUP);
    return Layer.succeed(PaymentDialsTag, {
      paymentWindowMs: yield* group.getNumber('paymentWindow'),
      paymentGraceMs: yield* group.getNumber('paymentWindowGrace'),
    });
  });

/** Every window a flow start may be stated with. */
export type FlowDials = DeliveryDials & PaymentDials;
