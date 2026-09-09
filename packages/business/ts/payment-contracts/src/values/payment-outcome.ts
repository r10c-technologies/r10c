import {
  type DomainEvent,
  EntifixBuildError,
  type EntifixError,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/**
 * Money was taken for an order. Routing key and register name.
 *
 * @see ADR 0054 — capture is the checkout saga's pivot, and this event is what
 * the steps *after* the decision read.
 */
export const PAYMENT_CAPTURED = 'payment.captured';

/**
 * The attempt did not succeed. Emitted for the record and for a vendor's
 * reconciliation; the checkout saga does **not** consume it, because a capture
 * that refuses is answered by compensating the flow synchronously rather than
 * by waiting for a message about it.
 */
export const PAYMENT_FAILED = 'payment.failed';

/** Every payment outcome the bus carries, as a routable name. */
export const PAYMENT_EVENTS = [PAYMENT_CAPTURED, PAYMENT_FAILED] as const;

/** One of the two payment outcome events. */
export type PaymentEventName = (typeof PAYMENT_EVENTS)[number];

/**
 * What one payment outcome announces.
 *
 * **One shape for both event names**, the choice `CatalogPublication` made and
 * for the same reason: a payload that varies by name means two decoders, and
 * two decoders means two places for a consumer's guard to be skipped. The name
 * says what happened; {@link PaymentOutcome.failureReason} is simply absent on a
 * capture.
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
   * Why a `payment.failed` failed. Absent on a capture, and absent on a failure
   * the adapter could not explain.
   */
  readonly failureReason?: string;
}

/**
 * The message id, and therefore the **deduplication key**.
 *
 * `<paymentId>:<decidedAt>`, never the payment id alone. One payment may be
 * authorized and later captured, so an id keyed on the payment alone would make
 * the capture look like a redelivery of the authorization and drop it — the same
 * rule `catalogEventId` follows, and the one `transactionEventId` follows for
 * `<transactionId>:<step>`.
 */
export const paymentEventId = (outcome: PaymentOutcome): string =>
  `${outcome.paymentId}:${outcome.decidedAt}`;

/** Wraps an outcome as a routable message from `source`. */
const message = (
  name: PaymentEventName,
  source: string,
  data: PaymentOutcome,
): DomainEvent<PaymentOutcome> => ({
  name,
  id: paymentEventId(data),
  source,
  at: data.decidedAt,
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
): DomainEvent<PaymentOutcome> => message(PAYMENT_CAPTURED, source, outcome);

export const paymentFailedEvent = (
  outcome: PaymentOutcome,
  source: string,
): DomainEvent<PaymentOutcome> => message(PAYMENT_FAILED, source, outcome);

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
 * Reads a bus payload back into a {@link PaymentOutcome}.
 *
 * This exists **here** rather than in the transport for the reason
 * `readEventEnvelope` states about itself: it validates `meta` and deliberately
 * not `data`, because the bus has no idea what a `payment.captured` payload
 * should look like and inventing an opinion there is how a transport starts
 * knowing about domains.
 *
 * ⚠️ **It rejects rather than coerces**, and that decides the message's fate:
 * `AmqpEventBusLayer` classifies a rejected payload as **poison** and
 * quarantines it with zero retries, while a lenient cast would turn a payload
 * that can never parse into a handler failure — requeued, counted against
 * `x-delivery-limit`, and spending the budget of every message behind it
 * (ADR 0030).
 */
export const readPaymentOutcome = (
  data: unknown,
): Effect.Effect<PaymentOutcome, EntifixError> =>
  Effect.gen(function* () {
    if (data === null || typeof data !== 'object') {
      return yield* Effect.fail(
        new EntifixBuildError(
          'payment outcome payload is not an object',
          undefined,
          { data },
        ),
      );
    }

    const raw = data as Record<string, unknown>;
    const missing: string[] = [];

    if (!isNonEmptyString(raw['paymentId'])) missing.push('paymentId');
    if (!isNonEmptyString(raw['orderId'])) missing.push('orderId');
    if (!isNonEmptyString(raw['currency'])) missing.push('currency');
    if (!isNonEmptyString(raw['paymentMethod'])) missing.push('paymentMethod');
    if (!isNonEmptyString(raw['decidedAt'])) missing.push('decidedAt');
    // `Number.isFinite` and not `typeof === 'number'`: `NaN` is a number, and a
    // NaN amount reaches Mongo, stores, and settles as an amount owed.
    if (!Number.isFinite(raw['amount'])) missing.push('amount');

    if (missing.length > 0) {
      return yield* Effect.fail(
        new EntifixBuildError(
          `payment outcome payload is missing or malformed (${missing.join(', ')})`,
          undefined,
          { missing, data },
        ),
      );
    }

    return {
      paymentId: raw['paymentId'] as string,
      orderId: raw['orderId'] as string,
      amount: raw['amount'] as number,
      currency: raw['currency'] as string,
      paymentMethod: raw['paymentMethod'] as string,
      decidedAt: raw['decidedAt'] as string,
      channelId: optionalString(raw['channelId']),
      providerReference: optionalString(raw['providerReference']),
      failureReason: optionalString(raw['failureReason']),
    };
  });
