import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_CAPTURED,
  PAYMENT_FAILED,
  paymentCapturedEvent,
  paymentEventId,
  paymentFailedEvent,
  type PaymentOutcome,
  readPaymentOutcome,
} from './payment-outcome.js';

const captured: PaymentOutcome = {
  paymentId: 'pay-1',
  orderId: 'order-1',
  amount: 12_500,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-01-01T00:00:00.000Z',
};

const read = (data: unknown) =>
  Effect.runSync(Effect.either(readPaymentOutcome(data)));

describe('paymentEventId', () => {
  /**
   * ⚠️ The member that makes an authorization and a later capture two messages
   * rather than one redelivered twice.
   */
  it('keys on the payment and the moment, never the payment alone', () => {
    expect(paymentEventId(captured)).toBe('pay-1:2026-01-01T00:00:00.000Z');
    expect(
      paymentEventId({ ...captured, decidedAt: '2026-01-02T00:00:00.000Z' }),
    ).not.toBe(paymentEventId(captured));
  });
});

describe('the two event builders', () => {
  it('names the event and signs it with the emitting slice', () => {
    expect(paymentCapturedEvent(captured, 'payment')).toMatchObject({
      name: PAYMENT_CAPTURED,
      source: 'payment',
      at: captured.decidedAt,
      data: captured,
    });
    expect(paymentFailedEvent(captured, 'payment').name).toBe(PAYMENT_FAILED);
  });

  /** The order, not the payment — it is what ties the whole flow together. */
  it('correlates on the order', () => {
    expect(paymentCapturedEvent(captured, 'payment').correlationId).toBe(
      'order-1',
    );
  });
});

describe('readPaymentOutcome', () => {
  it('reads a well-formed payload', () => {
    const outcome = read({ ...captured });
    expect(Either.isRight(outcome)).toBe(true);
    expect(Either.getOrThrow(outcome)).toEqual({
      ...captured,
      channelId: undefined,
      providerReference: undefined,
      failureReason: undefined,
    });
  });

  it('rejects a payload that is not an object', () => {
    expect(Either.isLeft(read('pay-1'))).toBe(true);
    expect(Either.isLeft(read(null))).toBe(true);
  });

  it('names every member it is missing, rather than the first', () => {
    const outcome = read({ amount: 1 });
    expect(Either.isLeft(outcome)).toBe(true);
    const message = Either.isLeft(outcome) ? outcome.left.message : '';
    expect(message).toContain('paymentId');
    expect(message).toContain('orderId');
    expect(message).toContain('currency');
    expect(message).toContain('paymentMethod');
    expect(message).toContain('decidedAt');
  });

  /**
   * ⚠️ `NaN` is a `number`. A lenient check would let it through, and it would
   * reach Mongo, store, and settle as an amount owed to a vendor.
   */
  it('rejects a NaN amount', () => {
    expect(Either.isLeft(read({ ...captured, amount: Number.NaN }))).toBe(true);
  });

  /**
   * ⚠️ The round-trip case. The driver writes `undefined` as BSON `null`, so a
   * member built absent on the emitting side arrives here as `null` — and
   * rejecting it would quarantine a message this package itself produced.
   */
  it('folds every absent form of an optional member to undefined', () => {
    const outcome = read({
      ...captured,
      channelId: null,
      providerReference: '',
      failureReason: undefined,
    });
    expect(Either.getOrThrow(outcome)).toMatchObject({
      channelId: undefined,
      providerReference: undefined,
      failureReason: undefined,
    });
  });

  it('keeps the optional members it is given', () => {
    const outcome = read({
      ...captured,
      channelId: 'counter-1',
      providerReference: 'psp-9',
      failureReason: 'insufficient funds',
    });
    expect(Either.getOrThrow(outcome)).toMatchObject({
      channelId: 'counter-1',
      providerReference: 'psp-9',
      failureReason: 'insufficient funds',
    });
  });
});
