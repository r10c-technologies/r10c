import { type EntityApiContext, IdempotencyKeyTag } from '@entifix/business';
import { makeEntityEnvelope } from '@entifix/core';
import {
  Payment,
  PaymentLedgerTag,
  PaymentProviderTag,
} from '@r10c/business-ts-payment-management';
import {
  makeInMemoryPaymentLedger,
  makeScriptedPaymentProvider,
} from '@r10c/business-ts-payment-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { paymentApi, refundApi } from './payment-api.js';

const context: EntityApiContext = {
  links: {
    record: id => [{ rel: 'self', href: `/api/x/${String(id)}` }],
    collection: () => [],
  },
};

/** One ledger per case; the provider declines whatever order `declined` names. */
const world = (declined?: string) => {
  const layer = Layer.mergeAll(
    Layer.succeed(PaymentLedgerTag, makeInMemoryPaymentLedger()),
    Layer.succeed(
      PaymentProviderTag,
      makeScriptedPaymentProvider(request => request.orderId === declined),
    ),
  );
  type R = PaymentLedgerTag | PaymentProviderTag;
  return {
    run: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.provide(effect, layer)),
    refusal: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.flip(Effect.provide(effect, layer))),
  };
};

const capture = (orderId: string, amount = 40) =>
  paymentApi.options.override.create.handler(
    {
      payload: makeEntityEnvelope(
        Payment,
        Object.assign(new Payment(orderId, amount, 'GTQ'), {
          paymentMethod: 'card',
        }),
      ),
    },
    context,
  );

const refund = (orderId: string) =>
  refundApi.options.override.create.handler({ payload: { orderId } }, context);

const keyed = <A, E, R>(effect: Effect.Effect<A, E, R>, key: string) =>
  Effect.provideService(effect, IdempotencyKeyTag, key);

describe('the payment declarations', () => {
  it('read behind the grant and take money by crossing, claimed in the unit', () => {
    for (const api of [paymentApi, refundApi]) {
      expect(api.options.guard).toEqual({
        read: { kind: 'permission' },
        write: { kind: 'crossing', organization: false },
      });
      expect(api.options.override.create.idempotent).toBe('unit');
    }
  });

  it('captures, and answers a redelivered command with the same payment', async () => {
    const { run } = world();

    const first = await run(keyed(capture('order-1'), 'cmd-1'));
    const again = await run(keyed(capture('order-1'), 'cmd-1'));

    expect(first).toMatchObject({ data: { status: 'captured' } });
    expect(again).toEqual(first);
  });

  it('answers a declined capture with the provider’s reason, and a payment for nothing as invalid', async () => {
    const { refusal } = world('order-2');

    const declined = await refusal(capture('order-2'));
    const empty = await refusal(capture('order-3', 0));

    expect(declined).toMatchObject({
      code: 'paymentDeclined',
      category: 'declined',
      reason: 'declined',
    });
    expect(empty).toMatchObject({ code: 'invalidBody' });
  });

  it('refunds by order, for the capture’s amount, and refuses an order nobody paid for', async () => {
    const { run, refusal } = world();
    await run(capture('order-4', 25));

    const refunded = await run(keyed(refund('order-4'), 'r-1'));
    const unpaid = await refusal(refund('order-5'));

    expect(refunded).toMatchObject({
      data: { amount: 25, status: 'refunded' },
    });
    expect(unpaid).toMatchObject({ code: 'noCapturedPayment' });
  });
});
