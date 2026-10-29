import {
  type AggregateRef,
  type DomainEvent,
  Invalid,
  openStruct,
  registerEvent,
  type TransitionalFailure,
} from '@entifix/core';
import { Effect, Schema } from 'effect';

/**
 * A payload this process cannot read, as a typed `invalid` failure. Business
 * family, so the bus quarantines it at once rather than redelivering a message
 * no retry will fix (ADR 0030, ADR 0064) — the legacy `EntifixBuildError` it
 * replaces is not a typed failure, and since entifix 0.10.0 the adapter reads
 * anything untyped as transient.
 */
const invalidPayload = (detail: string) =>
  new Invalid({ errors: [{ pointer: '/data', detail, code: 'malformed' }] });

/**
 * Money was taken for an order. Routing key and register name.
 *
 * @see ADR 0054 — capture is the checkout saga's pivot, and this event is what
 * the steps *after* the decision read.
 */
export const PAYMENT_CAPTURED = 'payment.captured';

/**
 * Money went back for an order.
 *
 * ⚠️ **Not the absence of a {@link PAYMENT_CAPTURED}, and not its correction.**
 * The capture stands; this announces a second money movement with its own record
 * and its own decision time. A consumer that folded a sale on the capture
 * reverses it on this, which is why settlement joins the two rather than
 * subtracting one from the other
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * ⚠️ **Distinct from a declined capture, which announces nothing.** A refusal
 * has nothing to settle and nothing to un-settle, and no slice subscribes to one
 * (ADR 0068); a refund has something that was settled and now must be undone.
 */
export const PAYMENT_REFUNDED = 'payment.refunded';

/** Every payment outcome the bus carries, as a routable name. */
export const PAYMENT_EVENTS = [PAYMENT_CAPTURED, PAYMENT_REFUNDED] as const;

/** One of the payment outcome events. */
export type PaymentEventName = (typeof PAYMENT_EVENTS)[number];

/**
 * What one payment outcome announces.
 *
 * **One shape for all three event names**, the choice `CatalogPublication` made
 * and for the same reason: a payload that varies by name means three decoders,
 * and three decoders means three places for a consumer's guard to be skipped.
 * The name says what happened; {@link PaymentOutcome.failureReason} is simply
 * absent on a capture and {@link PaymentOutcome.refundId} on everything but a
 * refund.
 *
 * ⚠️ **The optional members are optional as a safety property, not as laxity.**
 * {@link readPaymentOutcome} rejecting a payload classifies the message
 * **poison**, which `AmqpEventBusLayer` quarantines with zero retries
 * (ADR 0030) — so requiring a member the source may legitimately lack makes that
 * payment permanently unannounceable, and would turn every message already
 * sitting in the queue into poison the moment this shape widened.
 */
export interface PaymentOutcome {
  /** The `Payment.id` this outcome is about. The natural key. */
  readonly paymentId: string;
  /**
   * The order the money was for.
   *
   * A plain id and never a link: the target is another slice's store, and a
   * typed link would be both an illegal import under the boundary rule and the
   * storage-layer join `_shared/planes.md` forbids. It is also the member
   * order-service matches on to advance the order it already holds.
   */
  readonly orderId: string;
  /** Minor units, matching `Payment.amount` and `ProductOfferingPrice.amount`. */
  readonly amount: number;
  readonly currency: string;
  /**
   * Which kind of tender this was — `cash`, `card`, `voucher` or `transfer`.
   *
   * A bare string rather than the `PaymentMethod` union, because this package is
   * `business:policy` and may not reach `payment-management` to import it. The
   * same duplication `settlement-management` carries for the channel literals,
   * and the same guard against it: a consumer that cares compares against its
   * own copy, and nothing here branches on the value.
   */
  readonly paymentMethod: string;
  /**
   * ISO-8601. When the outcome was decided, and therefore the **ordering key**
   * a consumer's write guard compares.
   *
   * Not decoration. At-least-once delivery can land a redelivered capture after
   * a later state change, and comparing this member is what keeps a fold from
   * walking an order's status backwards.
   */
  readonly decidedAt: string;
  /**
   * The `SalesChannel` the money was taken through, when there was one.
   *
   * Absent for a storefront sale, present for a counter one. Settlement resolves
   * the commission rate from it (ADR 0024); order-service ignores it.
   */
  readonly channelId?: string;
  /**
   * The provider's own id for the attempt. Absent for cash, and absent when the
   * provider was never reached.
   */
  readonly providerReference?: string;
  /**
   * Why a declined capture was declined, as the ledger records it. Absent on a
   * capture, and absent on a failure the adapter could not explain.
   */
  readonly failureReason?: string;
  /**
   * The `Refund.id` on a `payment.refunded`, absent on every other name.
   *
   * It is what joins the announcement back to the record that produced it. The
   * outcome keeps carrying {@link PaymentOutcome.paymentId} beside it — the
   * capture being reversed — because that is what a reconciliation pairs and
   * what the deduplication key is built from.
   */
  readonly refundId?: string;
}

/**
 * The message id, and therefore the **deduplication key**.
 *
 * `<paymentId>:<decidedAt>`, never the payment id alone. One payment may be
 * authorized and later captured, so an id keyed on the payment alone would make
 * the capture look like a redelivery of the authorization and drop it — the same
 * rule `catalogEventId` follows, and the one `transactionEventId` follows for
 * `<transactionId>:<step>`.
 *
 * ⚠️ **A refund carries its own id in the key**, `<paymentId>:refund:<refundId>`.
 * It names the capture it reverses as its `paymentId`, and a decision time is a
 * millisecond: a capture and its refund decided in the same one — measured in
 * the mock suite, and entirely possible for a saga that cancels at once — made
 * one key, the outbox refused the refund's announcement as a redelivery, and
 * the money went back with nobody told.
 */
export const paymentEventId = (outcome: PaymentOutcome): string =>
  outcome.refundId === undefined
    ? `${outcome.paymentId}:${outcome.decidedAt}`
    : `${outcome.paymentId}:refund:${outcome.refundId}`;

/** A payment event: about one payment, at the version its decision names. */
export type PaymentEvent = DomainEvent<PaymentOutcome> & {
  aggregate: AggregateRef;
  version: number;
};

/**
 * Wraps an outcome as a routable message from `source`. The payment is the
 * aggregate and `decidedAt` as epoch milliseconds its version, so a refund —
 * decided after the capture it reverses — is always the later version.
 */
const message = (
  name: PaymentEventName,
  source: string,
  data: PaymentOutcome,
): PaymentEvent => ({
  name,
  id: paymentEventId(data),
  source,
  at: data.decidedAt,
  aggregate: { type: 'payment', id: data.paymentId },
  version: Date.parse(data.decidedAt),
  // The order, not the payment: it is what correlates this message with the
  // `order.placed` before it and the settlement entry after it.
  correlationId: data.orderId,
  data,
});

/**
 * `source` is the **emitting slice** (`payment`), never the deployment and never
 * the domain — ADR 0029, and it comes from `EventSourceTag` at the composition
 * root so a service that forgets it fails to build its layer rather than
 * publishing events signed by nobody.
 */
export const paymentCapturedEvent = (
  outcome: PaymentOutcome,
  source: string,
): PaymentEvent => message(PAYMENT_CAPTURED, source, outcome);

export const paymentRefundedEvent = (
  outcome: PaymentOutcome,
  source: string,
): PaymentEvent => message(PAYMENT_REFUNDED, source, outcome);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * Reads an optional member, normalizing every way it can be missing to
 * `undefined`. It **never rejects**.
 *
 * ⚠️ The `null` arm is load-bearing rather than defensive. The driver's default
 * writes `undefined` as BSON `null`, and the outbox stores the whole event
 * document — so a member built as `undefined` on the emitting side arrives here
 * as `null` after the round trip. A reader that accepted only
 * `string | undefined` would quarantine a message it had itself produced.
 */
const optionalString = (value: unknown): string | undefined =>
  isNonEmptyString(value) ? value : undefined;

/**
 * What a payment event's `data` must hold. `amount` is finite, not merely a
 * number: a NaN amount reaches Mongo and settles as an amount owed.
 */
export const PaymentOutcomeSchema = openStruct({
  paymentId: Schema.NonEmptyString,
  orderId: Schema.NonEmptyString,
  amount: Schema.Finite,
  currency: Schema.NonEmptyString,
  paymentMethod: Schema.NonEmptyString,
  decidedAt: Schema.NonEmptyString,
});

// Audience-free: a payment event is folded by order-service and settlement,
// and no person is ever sent it — the buyer learns how a payment went from the
// flow that took it.
for (const name of PAYMENT_EVENTS)
  registerEvent(name, PaymentOutcomeSchema, {
    versioned: true,
    audience: 'none',
  });

/**
 * Reads a payment event's `data` through the registered schema, folding the
 * optional members `''` to absent.
 */
export const readPaymentOutcome = (
  data: unknown,
): Effect.Effect<PaymentOutcome, TransitionalFailure> =>
  Effect.map(
    Schema.decodeUnknownEffect(PaymentOutcomeSchema)(data, {
      errors: 'all',
    }).pipe(
      Effect.mapError(error =>
        invalidPayload(
          `payment outcome payload is malformed: ${error.message}`,
        ),
      ),
    ),
    raw => ({
      paymentId: raw.paymentId,
      orderId: raw.orderId,
      amount: raw.amount,
      currency: raw.currency,
      paymentMethod: raw.paymentMethod,
      decidedAt: raw.decidedAt,
      channelId: optionalString(raw['channelId']),
      providerReference: optionalString(raw['providerReference']),
      failureReason: optionalString(raw['failureReason']),
      refundId: optionalString(raw['refundId']),
    }),
  );
