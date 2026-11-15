import { describe, expect, it } from 'vitest';

import { STOCK_SEARCH_SOURCES } from './search-sources';
import {
  MARKETPLACE_ADMIN_SERVICE_URL,
  STOCK_SERVICE_URL,
} from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping the
 * `references` declaration from `StockItem.offeringId` fails *here*, loudly,
 * rather than in a palette that quietly reports a group it could not reach.
 *
 * Every source is searched through the offering it is for (#552): the term is
 * matched against the offering's name at marketplace-admin-service, and the
 * stock records referring to the matches are read and named after them.
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
  ])(
    'names a %s result after its offering, and routes it here',
    (key, href) => {
      const source = STOCK_SEARCH_SOURCES.find(
        candidate => candidate.key === key,
      );

      const option = source?.read(
        {
          meta: { type: 'entityPage', entity: key },
          data: { items: [{ id: 'x-1', offeringId: 'o-1' }], total: 1 },
        },
        'es',
        new Map([['o-1', 'Taza de cerámica']]),
      )?.items[0];
      expect(option).toMatchObject({ label: 'Taza de cerámica', href });
    },
  );

  it('matches the offering’s name at its owner, then reads the stock here', () => {
    for (const source of STOCK_SEARCH_SOURCES) {
      const through = source.through;
      expect(through?.url('taza', 5, 'es')).toMatch(
        new RegExp(`^${MARKETPLACE_ADMIN_SERVICE_URL}/api/product-offering\\?`),
      );
      expect(through?.url('taza', 5, 'es')).toContain('taza');
      expect(
        through
          ?.urlFor(['o-1', 'o-2'], 5)
          .startsWith(`${STOCK_SERVICE_URL}/api/${source.key}?`),
      ).toBe(true);
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

describe('MARKETPLACE_ADMIN_SERVICE_URL', () => {
  it('defaults to the port the fleet convention allocates', () => {
    expect(MARKETPLACE_ADMIN_SERVICE_URL).toBe(
      process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101',
    );
  });
});
