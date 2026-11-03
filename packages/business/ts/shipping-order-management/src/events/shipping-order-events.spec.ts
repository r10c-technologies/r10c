import { describe, expect, it } from 'vitest';

import {
  EVENT_OF,
  SHIPPING_ORDER_DELIVERED,
  SHIPPING_ORDER_EVENTS,
  shippingOrderEvent,
} from './shipping-order-events.js';

describe('shippingOrderEvent', () => {
  it('addresses the vendor, correlates on the waiting flow, and versions the lifecycle', () => {
    const event = shippingOrderEvent(
      SHIPPING_ORDER_DELIVERED,
      'org-1',
      { id: 's-1', flowId: 'flow-1', status: 'delivered' },
      'fulfilment',
    );

    expect(event).toMatchObject({
      name: 'shipping-order.delivered',
      id: 's-1:delivered',
      correlationId: 'flow-1',
      aggregate: { type: 'shipping-order', id: 's-1' },
      version: 2,
      audience: [{ kind: 'organization', id: 'org-1' }],
    });
  });

  it('correlates on the shipment when no flow waits on it', () => {
    expect(
      shippingOrderEvent(SHIPPING_ORDER_DELIVERED, 'org-1', { id: 's-2' }, 'f')
        .correlationId,
    ).toBe('s-2');
  });

  it('announces exactly the four moves past dispatch', () => {
    expect(Object.values(EVENT_OF)).toEqual([...SHIPPING_ORDER_EVENTS]);
  });
});
