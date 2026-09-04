import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_SEARCH_SOURCES } from './search-sources';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: removing `filterable`
 * from `ProductBrand.name` fails *here*, loudly, rather than in a palette that
 * quietly reports a group it could not reach.
 */
describe('MARKETPLACE_ADMIN_SEARCH_SOURCES', () => {
  it('declares the catalog’s three searchable records, in order', () => {
    expect(MARKETPLACE_ADMIN_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'product-specification',
      'product-brand',
      'product-category',
    ]);
  });

  it('labels each group with the entity’s own plural key', () => {
    expect(
      MARKETPLACE_ADMIN_SEARCH_SOURCES.map(source => source.labelKey),
    ).toEqual([
      'entity:product-specification.plural',
      'entity:product-brand.plural',
      'entity:product-category.plural',
    ]);
  });

  it.each([
    // `product`, not `product-specification` — the route segment and the entity
    // key differ, and they have drifted apart once already.
    ['product-specification', '/catalog/product/x-1'],
    ['product-brand', '/catalog/product-brand/x-1'],
    ['product-category', '/catalog/product-category/x-1'],
  ])('routes a %s result to a page this host serves', (key, expected) => {
    const source = MARKETPLACE_ADMIN_SEARCH_SOURCES.find(
      candidate => candidate.key === key,
    );

    expect(source?.url('acme', 5)).toContain(`/api/${key}?`);
    // One option is enough to prove the href builder; the mapping itself is
    // covered where it lives.
    expect(
      source?.read({
        meta: { type: 'entityPage', entity: key },
        data: { items: [{ id: 'x-1' }], total: 1 },
      })?.items[0]?.href,
    ).toBe(expected);
  });

  it('asks the tenant service for specifications and the platform one for the vocabulary', () => {
    const [specification, brand, category] = MARKETPLACE_ADMIN_SEARCH_SOURCES;

    // Two services since ADR 0022, which is also why one of these can answer
    // `409` for a caller the other two serve happily.
    expect(specification?.url('acme', 5)).toContain('localhost:3101');
    expect(brand?.url('acme', 5)).toContain('localhost:3100');
    expect(category?.url('acme', 5)).toContain('localhost:3100');
  });
});
