import { describe, expect, it } from 'vitest';

import { SALES_SEARCH_SOURCES } from './search-sources.js';
import { SALES_SERVICE_URL } from './service-urls.js';

/**
 * The declaration is validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping `filterable`
 * from `SalesChannel.name` fails *here*, loudly, rather than in a palette that
 * quietly reports a group it could not reach.
 *
 * That guard is load-bearing for this domain. `name` is the only member of the
 * entity a source can name a record by — the other two are enums, and a partial
 * term against an enum answers `400` on every keystroke short of a whole value.
 */
describe('SALES_SEARCH_SOURCES', () => {
  it('declares the one searchable sales record', () => {
    expect(SALES_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'sales-channel',
    ]);
  });

  it('labels the group with the entity`s own plural key', () => {
    expect(SALES_SEARCH_SOURCES[0]?.labelKey).toBe(
      'entity:sales-channel.plural',
    );
  });

  it('routes a hit to the page this host actually serves', () => {
    const source = SALES_SEARCH_SOURCES[0];

    expect(source?.url('Mostrador', 5)).toContain('/api/sales-channel?');
    expect(
      source?.read({
        meta: { type: 'entityPage', entity: 'sales-channel' },
        data: { items: [{ id: 'channel-1' }], total: 1 },
      })?.items[0]?.href,
    ).toBe('/sales/sales-channel/channel-1');
  });

  it('fans out to sales-service, not to a catalog backend', () => {
    // Four backends now, and pointing a source at the wrong one is how a search
    // group asks for a route that does not exist while a fixture stubbing the
    // same wrong address cannot see it.
    expect(
      SALES_SEARCH_SOURCES[0]?.url('anything', 1).startsWith(SALES_SERVICE_URL),
    ).toBe(true);
  });
});

describe('SALES_SERVICE_URL', () => {
  it('defaults to the port the fleet convention allocates', () => {
    // `310N` with sales at domain index 9.
    expect(SALES_SERVICE_URL).toBe(
      process.env.SALES_SERVICE_URL ?? 'http://localhost:3109',
    );
  });
});
