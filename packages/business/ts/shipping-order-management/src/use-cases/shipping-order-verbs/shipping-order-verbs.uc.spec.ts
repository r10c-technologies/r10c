import { describeEntityUseCases } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../../entities/shipping-order/index.js';
import {
  DISPATCH_SHIPPING_ORDER,
  DispatchShippingOrderUC,
  RECORD_DELIVERY,
  RECORD_REFUSAL,
  RECORD_RETURN,
  RecordDeliveryUC,
  RecordRefusalUC,
  RecordReturnUC,
} from './shipping-order-verbs.uc.js';

const order = (status: string) =>
  ({ id: 's-1', status }) as Parameters<typeof DispatchShippingOrderUC.run>[0];

describe('the vendor verbs', () => {
  it.each([
    [DispatchShippingOrderUC, 'awaiting-dispatch', 'dispatched'],
    [RecordDeliveryUC, 'dispatched', 'delivered'],
    [RecordRefusalUC, 'dispatched', 'refused'],
    [RecordReturnUC, 'refused', 'returned'],
  ] as const)('%o moves %s to %s', async (verb, from, to) => {
    expect(await Effect.runPromise(verb.run(order(from)))).toEqual({
      from,
      to,
    });
  });

  it('refuses a move the status does not allow, naming where it stood', async () => {
    const refused = await Effect.runPromise(
      Effect.flip(DispatchShippingOrderUC.run(order('held'))),
    );

    expect(refused).toMatchObject({
      code: 'shippingOrderNotTransitionable',
      shippingOrderId: 's-1',
      standing: 'held',
      transition: 'dispatch',
    });
    expect((refused as Error).message).toBe(
      "a shipping order in 'held' cannot dispatch",
    );
  });

  it('derives one permission per verb in the shipping-order namespace', () => {
    expect([
      DISPATCH_SHIPPING_ORDER,
      RECORD_DELIVERY,
      RECORD_REFUSAL,
      RECORD_RETURN,
    ]).toEqual([
      'shipping-order-management:shipping-order:dispatch',
      'shipping-order-management:shipping-order:record-delivery',
      'shipping-order-management:shipping-order:record-refusal',
      'shipping-order-management:shipping-order:record-return',
    ]);
  });
});

describe('where each verb is offered', () => {
  const declared = Object.fromEntries(
    describeEntityUseCases(ShippingOrder).map(descriptor => [
      descriptor.key,
      descriptor,
    ]),
  );

  // Read off the transition table, so a shipment's form offers exactly the
  // moves the store would accept from where it stands.
  it.each([
    ['dispatch', ['awaiting-dispatch']],
    ['record-delivery', ['dispatched']],
    ['record-refusal', ['dispatched']],
    ['record-return', ['refused']],
  ])('%s is offered from %o', (key, states) => {
    expect(declared[key]?.availableWhen).toEqual({
      member: 'status',
      in: states,
    });
  });

  it('asks before the three moves that cannot be taken back, and not before a delivery', () => {
    expect(declared['dispatch']?.confirm?.tone).toBe('neutral');
    expect(declared['record-refusal']?.confirm?.tone).toBe('neutral');
    expect(declared['record-return']?.confirm?.tone).toBe('neutral');
    expect(declared['record-delivery']?.confirm).toBeUndefined();
  });

  it('dispatches over a selection too, under the one permission', () => {
    expect(declared['dispatch']?.alsoAt).toEqual([
      { binding: 'collection', placement: 'context-dependent' },
    ]);
  });
});
