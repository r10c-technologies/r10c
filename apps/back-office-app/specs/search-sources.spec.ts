import { AUTH_SEARCH_SOURCES } from '@r10c/shells-next-auth/server';
import { FULFILMENT_SEARCH_SOURCES } from '@r10c/shells-next-fulfilment/server';
import { MARKETPLACE_ADMIN_SEARCH_SOURCES } from '@r10c/shells-next-marketplace-admin/server';
import { ORDER_SEARCH_SOURCES } from '@r10c/shells-next-order/server';
import { SALES_SEARCH_SOURCES } from '@r10c/shells-next-sales/server';
import { SETTLEMENT_SEARCH_SOURCES } from '@r10c/shells-next-settlement/server';
import { STOCK_SEARCH_SOURCES } from '@r10c/shells-next-stock/server';

import { NAV } from '../src/lib/nav';
import { SEARCH_SOURCES } from '../src/lib/search-sources';

/**
 * The host's composition, not the declarations themselves — each shell's spec
 * already re-runs `defineRecordSearchSource`'s guards against live metadata.
 * What only this level can see is whether the two shells' lists agree with the
 * screens this app actually serves.
 */
describe('SEARCH_SOURCES', () => {
  it('composes all seven shells, catalog then stock then orders then shipments then sales then settlement then people', () => {
    // Order is the ranking, so this asserts the order of the shells: an
    // operator learns where a kind of record lands, and a reshuffle is a
    // behaviour change even though every source still resolves. Each shell's
    // own spec asserts what it contributes (#773).
    const shells = [
      MARKETPLACE_ADMIN_SEARCH_SOURCES,
      STOCK_SEARCH_SOURCES,
      ORDER_SEARCH_SOURCES,
      FULFILMENT_SEARCH_SOURCES,
      SALES_SEARCH_SOURCES,
      SETTLEMENT_SEARCH_SOURCES,
      AUTH_SEARCH_SOURCES,
    ];
    expect(shells.every(sources => sources.length > 0)).toBe(true);
    expect(SEARCH_SOURCES.map(source => source.key)).toEqual(
      shells.flat().map(source => source.key),
    );
  });

  it('leaves the settlement run out: it has no string member to label it by', () => {
    // A source would label every run by its status and fill a palette with
    // results called "Calculada".
    expect(SEARCH_SOURCES.map(source => source.key)).not.toContain(
      'settlement-run',
    );
  });

  it('gives every source a distinct key, since the key selects and orders', () => {
    const keys = SEARCH_SOURCES.map(source => source.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * A result routes to `<basePath>/<id>`, and the nav is where this app declares
   * what `<basePath>` is. Two independently maintained strings that must agree —
   * the same shape of drift that once left "open in workspace" on Productos
   * silently doing nothing, and which nothing but an assertion like this
   * notices, because a dead link renders exactly like a live one.
   */
  it('routes every result under a path the sidebar also offers', () => {
    const navPaths = NAV.flatMap(section =>
      section.items.map(item => item.href),
    );

    for (const source of SEARCH_SOURCES) {
      const href = source.read({
        meta: { type: 'entityPage', entity: source.entity },
        data: { items: [{ id: 'x-1' }], total: 1 },
      })?.items[0]?.href;

      expect(
        navPaths.some(path => href?.startsWith(`${path}/`)),
        `${source.key} routes to "${String(href)}", which is under no nav destination`,
      ).toBe(true);
    }
  });
});
