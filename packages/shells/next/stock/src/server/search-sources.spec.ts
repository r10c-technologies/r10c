import { describe, expect, it } from 'vitest';

import { STOCK_SEARCH_SOURCES } from './search-sources';
import { STOCK_SERVICE_URL } from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping `sortable`
 * from `StockItem.offeringId` fails *here*, loudly, rather than in a palette
 * that quietly reports a group it could not reach.
 *
 * That guard is not hypothetical for this domain. `offeringId` is the only
 * member of any of these three entities that a source can name a record by —
 * everything else is a number or an enum — and it was made sortable for
 * exactly this.
 */
describe('STOCK_SEARCH_SOURCES', () => {
  it('declares the three searchable stock records, in order', () => {
    expect(STOCK_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'stock-item',
      'stock-movement',
      'reservation',
    ]);
  });

  it('labels each group with the entity’s own plural key', () => {
    expect(STOCK_SEARCH_SOURCES.map(source => source.labelKey)).toEqual([
      'entity:stock-item.plural',
      'entity:stock-movement.plural',
      'entity:reservation.plural',
    ]);
  });

  it.each([
    ['stock-item', '/stock/stock-item/x-1'],
    ['stock-movement', '/stock/stock-movement/x-1'],
    ['reservation', '/stock/reservation/x-1'],
  ])('routes a %s result to a page this host serves', (key, expected) => {
    const source = STOCK_SEARCH_SOURCES.find(
      candidate => candidate.key === key,
    );

    expect(source?.url('product-offering-1', 5)).toContain(`/api/${key}?`);
    expect(
      source?.read({
        meta: { type: 'entityPage', entity: key },
        data: { items: [{ id: 'x-1' }], total: 1 },
      })?.items[0]?.href,
    ).toBe(expected);
  });

  it('fans out to stock-service, not to a catalog backend', () => {
    // Three backends now, and pointing a source at the wrong one is how the
    // brand pages once requested routes that no longer existed while the e2e
    // fixture, stubbing the same wrong address, could not see it.
    for (const source of STOCK_SEARCH_SOURCES) {
      expect(source.url('anything', 1).startsWith(STOCK_SERVICE_URL)).toBe(
        true,
      );
    }
  });
});

describe('STOCK_SERVICE_URL', () => {
  it('defaults to the port the fleet convention allocates', () => {
    // `310N` with stock at domain index 8. Declared once because the proxy and
    // the search fan-out both need it, and a second copy of a default is how
    // one ends up pointing at a port nothing listens on.
    expect(STOCK_SERVICE_URL).toBe(
      process.env.STOCK_SERVICE_URL ?? 'http://localhost:3108',
    );
  });
});
