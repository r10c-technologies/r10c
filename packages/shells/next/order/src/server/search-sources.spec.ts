import { describe, expect, it } from 'vitest';

import { ORDER_SEARCH_SOURCES } from './search-sources';
import { ORDER_SERVICE_URL } from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping `sortable`
 * from `ProductOrder.buyerId` fails *here*, loudly, rather than in a palette
 * that quietly reports a group it could not reach.
 *
 * That guard is not hypothetical. `buyerId` is the only member of `ProductOrder`
 * a source can name a record by — `status` is an enum, `placedAt` a date, and
 * `items` a collection `describeEntityColumns` refuses to make queryable at all.
 */
describe('ORDER_SEARCH_SOURCES', () => {
  it('declares the one searchable order record', () => {
    expect(ORDER_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'product-order',
    ]);
  });

  it('labels the group with the entity’s own plural key', () => {
    expect(ORDER_SEARCH_SOURCES.map(source => source.labelKey)).toEqual([
      'entity:product-order.plural',
    ]);
  });

  it('routes a result to a page this host serves', () => {
    const source = ORDER_SEARCH_SOURCES[0];

    expect(source?.url('party-user-2', 5)).toContain('/api/product-order?');
    expect(
      source?.read({
        meta: { type: 'entityPage', entity: 'product-order' },
        data: { items: [{ id: 'ord-1' }], total: 1 },
      })?.items[0]?.href,
    ).toBe('/order/product-order/ord-1');
  });

  it('fans out to order-service, not to a catalog backend', () => {
    // Four backends now, and pointing a source at the wrong one is how the
    // brand pages once requested routes that no longer existed while the e2e
    // fixture, stubbing the same wrong address, could not see it.
    for (const source of ORDER_SEARCH_SOURCES) {
      expect(source.url('anything', 1).startsWith(ORDER_SERVICE_URL)).toBe(true);
    }
  });
});

describe('ORDER_SERVICE_URL', () => {
  it('defaults to the port the fleet convention allocates', () => {
    // `310N` with order at domain index 5. Declared once because the proxy and
    // the search fan-out both need it, and a second copy of a default is how one
    // ends up pointing at a port nothing listens on.
    expect(ORDER_SERVICE_URL).toBe(
      process.env.ORDER_SERVICE_URL ?? 'http://localhost:3105',
    );
  });
});
