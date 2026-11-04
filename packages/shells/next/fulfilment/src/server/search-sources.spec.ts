import { describe, expect, it } from 'vitest';

import { FULFILMENT_SEARCH_SOURCES } from './search-sources';
import { FULFILMENT_SERVICE_URL } from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import is most of the test: dropping `sortable` from
 * `ShippingOrder.orderId` fails here, not in a palette that quietly reports a
 * group it could not reach.
 */
describe('FULFILMENT_SEARCH_SOURCES', () => {
  it('declares the one searchable shipment record', () => {
    expect(FULFILMENT_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'shipping-order',
    ]);
    expect(FULFILMENT_SEARCH_SOURCES.map(source => source.labelKey)).toEqual([
      'entity:shipping-order.plural',
    ]);
  });

  it('routes a result to a page this host serves', () => {
    const source = FULFILMENT_SEARCH_SOURCES[0];

    expect(source?.url('order-1', 5)).toContain('/api/shipping-order?');
    expect(
      source?.read({
        meta: { type: 'entityPage', entity: 'shipping-order' },
        data: { items: [{ id: 'so-1' }], total: 1 },
      })?.items[0]?.href,
    ).toBe('/fulfilment/shipping-order/so-1');
  });

  it('fans out to fulfilment-service', () => {
    for (const source of FULFILMENT_SEARCH_SOURCES) {
      expect(source.url('anything', 1).startsWith(FULFILMENT_SERVICE_URL)).toBe(
        true,
      );
    }
  });
});

describe('FULFILMENT_SERVICE_URL', () => {
  // `310N` with fulfilment at domain index 10.
  it('defaults to the port the fleet convention allocates', () => {
    expect(FULFILMENT_SERVICE_URL).toBe(
      process.env.FULFILMENT_SERVICE_URL ?? 'http://localhost:3110',
    );
  });
});
