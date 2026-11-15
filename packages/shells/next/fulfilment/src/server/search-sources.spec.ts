import { describe, expect, it } from 'vitest';

import { FULFILMENT_SEARCH_SOURCES } from './search-sources';
import { FULFILMENT_SERVICE_URL } from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import is most of the test: dropping `filterable` from
 * `ShippingOrder.orderId` fails here, not in a palette that quietly reports a
 * group it could not reach.
 *
 * A shipment is matched by the order it carries and named by nothing it holds:
 * a result names itself, noun and short id, until ADR 0076's order number
 * names it (#552).
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

    expect(source?.url('order-1', 5, 'es')).toContain('/api/shipping-order?');
    expect(
      source?.read(
        {
          meta: { type: 'entityPage', entity: 'shipping-order' },
          data: { items: [{ id: 'so-1' }], total: 1 },
        },
        'es',
      )?.items[0]?.href,
    ).toBe('/fulfilment/shipping-order/so-1');
  });

  it('names a result itself, never by the order id it carries', () => {
    const option = FULFILMENT_SEARCH_SOURCES[0]?.read(
      {
        meta: { type: 'entityPage', entity: 'shipping-order' },
        data: { items: [{ id: 'so-1', orderId: 'order-77' }], total: 1 },
      },
      'es',
    )?.items[0];

    expect(option).toMatchObject({ unnamed: true });
    expect(option?.label).not.toContain('order-77');
  });

  it('fans out to fulfilment-service', () => {
    for (const source of FULFILMENT_SEARCH_SOURCES) {
      expect(
        source.url('anything', 1, 'es').startsWith(FULFILMENT_SERVICE_URL),
      ).toBe(true);
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
