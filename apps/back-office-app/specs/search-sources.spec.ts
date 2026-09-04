import { NAV } from '../src/lib/nav';
import { SEARCH_SOURCES } from '../src/lib/search-sources';

/**
 * The host's composition, not the declarations themselves — each shell's spec
 * already re-runs `defineRecordSearchSource`'s guards against live metadata.
 * What only this level can see is whether the two shells' lists agree with the
 * screens this app actually serves.
 */
describe('SEARCH_SOURCES', () => {
  it('composes both shells, catalog before people', () => {
    expect(SEARCH_SOURCES.map(source => source.key)).toEqual([
      'product-specification',
      'product-brand',
      'product-category',
      'user-identity',
    ]);
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
