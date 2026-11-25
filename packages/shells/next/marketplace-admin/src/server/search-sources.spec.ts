import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from '../catalog-surfaces';
import { MARKETPLACE_ADMIN_SEARCH_SOURCES } from './search-sources';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: removing `filterable`
 * from `ProductBrand.name` fails *here*, loudly, rather than in a palette that
 * quietly reports a group it could not reach.
 */
describe('MARKETPLACE_ADMIN_SEARCH_SOURCES', () => {
  it('declares one source per catalog surface, in the table’s order', () => {
    // Derived (#773): the table's order is asserted once, in
    // `catalog-surfaces.spec.ts`; a new surface is searchable for free.
    expect(MARKETPLACE_ADMIN_SEARCH_SOURCES.map(source => source.key)).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface => surface.entityKey),
    );
  });

  it('labels each group with the entity’s own plural key', () => {
    expect(
      MARKETPLACE_ADMIN_SEARCH_SOURCES.map(source => source.labelKey),
    ).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(
        surface => `entity:${surface.entityKey}.plural`,
      ),
    );
  });

  it.each(
    MARKETPLACE_ADMIN_CATALOG_SURFACES.map(s => [s.entityKey, s] as const),
  )('routes a %s result to the page its surface serves', (key, surface) => {
    const source = MARKETPLACE_ADMIN_SEARCH_SOURCES.find(
      candidate => candidate.key === key,
    );

    expect(source?.url('acme', 5, 'es')).toContain(`/api/${key}?`);
    // The route, never the entity key: `product-specification` lives at
    // `/catalog/product`, and the two have drifted apart once already.
    expect(
      source?.read(
        {
          meta: { type: 'entityPage', entity: key },
          data: { items: [{ id: 'x-1' }], total: 1 },
        },
        'es',
      )?.items[0]?.href,
    ).toBe(`${surface.basePath}/x-1`);
  });

  it('asks the tenant service for specifications and the platform one for the vocabulary', () => {
    const [specification, offering, price, , brand, category] =
      MARKETPLACE_ADMIN_SEARCH_SOURCES;

    // Two services since ADR 0022, which is also why the tenant-plane three can
    // answer `409` for a caller the other two serve happily.
    expect(specification?.url('acme', 5, 'es')).toContain('localhost:3101');
    expect(offering?.url('acme', 5, 'es')).toContain('localhost:3101');
    // A price is found through its offering's name, at the same tenant
    // service, then read by the offerings that matched (#552).
    expect(price?.through?.url('taza', 5, 'es')).toContain(
      'localhost:3101/api/product-offering?',
    );
    expect(price?.through?.urlFor(['o-1'], 5)).toContain(
      'localhost:3101/api/product-offering-price?',
    );
    expect(brand?.url('acme', 5, 'es')).toContain('localhost:3100');
    expect(category?.url('acme', 5, 'es')).toContain('localhost:3100');
  });
});
