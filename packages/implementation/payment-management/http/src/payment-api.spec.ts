import { type EntityApiContext, IdempotencyKeyTag } from '@entifix/business';
import {
  CodAcceptanceTag,
  CodPolicyTag,
  PaymentLedgerTag,
  PaymentProviderTag,
} from '@r10c/business-ts-payment-management';
import {
  makeInMemoryPaymentLedger,
  makeScriptedPaymentProvider,
} from '@r10c/business-ts-payment-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  codEndpoints,
  paymentAllocationApi,
  paymentApi,
  refundApi,
} from './payment-api.js';

const context: EntityApiContext = {
  links: {
    record: id => [{ rel: 'self', href: `/api/x/${String(id)}` }],
    collection: () => [],
  },
};

/** One ledger per case; the provider declines whatever group `declined` names. */
const world = (declined?: string) => {
  const layer = Layer.mergeAll(
    Layer.succeed(PaymentLedgerTag, makeInMemoryPaymentLedger()),
    Layer.succeed(
      PaymentProviderTag,
      makeScriptedPaymentProvider(request => request.reference === declined),
    ),
    Layer.succeed(CodPolicyTag, { enabled: true, maxAmount: 1_000 }),
    Layer.succeed(CodAcceptanceTag, {
      acceptsCod: vendorId => Effect.succeed(vendorId !== 'vendor-no'),
    }),
  );
  type R =
    PaymentLedgerTag | PaymentProviderTag | CodPolicyTag | CodAcceptanceTag;
  return {
    run: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.provide(effect, layer)),
    refusal: <A, E>(effect: Effect.Effect<A, E, R>) =>
      Effect.runPromise(Effect.flip(Effect.provide(effect, layer))),
  };
};

/**
 * A capture as a checkout's flow asks for it: each card vendor's share, and
 * the order each vendor's segment wrote, by vendor.
 */
const capture = (
  groupId: string,
  amount = 40,
  method?: 'cash',
  orderId: Record<string, string> = {
    'vendor-1': `${groupId}-a`,
    'vendor-2': `${groupId}-b`,
  },
) =>
  paymentApi.options.override.create.handler(
    {
      payload: {
        groupId,
        currency: 'GTQ',
        ...(method === undefined ? {} : { paymentMethod: method }),
        shares: [
          { vendorId: 'vendor-1', amount: amount - 10 },
          { vendorId: 'vendor-2', amount: 10 },
        ],
        orderId,
      },
    },
    context,
  );

const refund = (orderId: string, amount?: number) =>
  refundApi.options.override.create.handler(
    { payload: { orderId, ...(amount === undefined ? {} : { amount }) } },
    context,
  );

const keyed = <A, E, R>(effect: Effect.Effect<A, E, R>, key: string) =>
  Effect.provideService(effect, IdempotencyKeyTag, key);

const [collection, codEligibility] = codEndpoints;

const collect = (orderId: string, amount = 25) =>
  collection.handler({
    payload: {
      groupId: 'group-c',
      orderId,
      vendorId: 'vendor-1',
      amount,
      currency: 'GTQ',
    },
  } as never);

const eligible = (vendorId: string, amount = 500) =>
  codEligibility.handler({ payload: { vendorId, amount } } as never);

describe('the payment declarations', () => {
  it('read behind the grant and take money by crossing, claimed in the unit', () => {
    for (const api of [paymentApi, refundApi]) {
      expect(api.options.guard).toEqual({
        read: { kind: 'permission' },
        write: { kind: 'crossing', organization: false },
      });
      expect(api.options.override.create.idempotent).toBe('unit');
    }
    expect(paymentAllocationApi.options.verbs).toEqual(['list', 'get']);
  });

  it('name the narrow crossing each cash-on-delivery route takes', () => {
    expect(collection.descriptor.guard).toMatchObject({
      permission: 'payment-management:collection:write',
    });
    expect(collection.descriptor.idempotent).toBe('unit');
    expect(codEligibility.descriptor.guard).toMatchObject({
      permission: 'payment-management:cod-eligibility:read',
    });
  });
});

describe('a capture', () => {
  it('takes one charge for the group, and answers a redelivered command with it', async () => {
    const { run } = world();

    const first = await run(keyed(capture('group-1'), 'cmd-1'));
    const again = await run(keyed(capture('group-1'), 'cmd-1'));
    const cash = await run(capture('group-2', 40, 'cash'));

    expect(first).toMatchObject({
      data: { groupId: 'group-1', status: 'captured', paymentMethod: 'card' },
    });
    expect(again).toEqual(first);
    expect(cash).toMatchObject({ data: { paymentMethod: 'cash' } });
  });

  it('answers a declined capture with the provider’s reason, and a split that does not add up as invalid', async () => {
    const { refusal } = world('group-2');

    const declined = await refusal(capture('group-2'));
    const empty = await refusal(capture('group-3', 0));
    const unordered = await refusal(
      capture('group-4', 40, undefined, { 'vendor-1': 'group-4-a' }),
    );

    expect(declined).toMatchObject({
      code: 'paymentDeclined',
      category: 'declined',
      reason: 'declined',
    });
    expect(empty).toMatchObject({ code: 'invalidBody' });
    expect(unordered).toMatchObject({
      code: 'invalidBody',
      reason: "a capture names no order for vendor 'vendor-2'",
    });
  });
});

describe('a refund', () => {
  it('gives back part of one order’s share, then the rest, then refuses more', async () => {
    const { run, refusal } = world();
    await run(capture('group-4', 40));

    const part = await run(keyed(refund('group-4-a', 10), 'r-1'));
    const rest = await run(refund('group-4-a'));
    const more = await refusal(refund('group-4-a', 1));
    const unpaid = await refusal(refund('order-5'));

    expect(part).toMatchObject({ data: { amount: 10, status: 'refunded' } });
    expect(rest).toMatchObject({ data: { amount: 20 } });
    expect(more).toMatchObject({ code: 'refundExceedsCapture' });
    expect(unpaid).toMatchObject({ code: 'noCapturedPayment' });
  });
});

describe('cash on delivery', () => {
  it('records a courier’s collection as a cod payment for the one order', async () => {
    const { run } = world();

    const recorded = await run(keyed(collect('order-c'), 'k-1'));

    expect(recorded).toMatchObject({
      data: { paymentMethod: 'cod', status: 'captured', amount: 25 },
    });
  });

  it('admits a seller who ships it under the limit, and refuses the rest', async () => {
    const { run, refusal } = world();

    expect(await run(eligible('vendor-1'))).toEqual({
      vendorId: 'vendor-1',
      eligible: true,
    });
    expect(await refusal(eligible('vendor-1', 1_001))).toMatchObject({
      code: 'codOverLimit',
    });
    expect(await refusal(eligible('vendor-no'))).toMatchObject({
      code: 'codNotEntitled',
    });
  });
});
