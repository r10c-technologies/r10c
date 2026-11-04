import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

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
