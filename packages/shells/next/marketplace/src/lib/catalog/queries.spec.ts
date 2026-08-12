import { describe, expect, it } from 'vitest';

import {
  getBrand,
  getCategory,
  getProduct,
  loadCategories,
  loadProducts,
} from './queries';

/**
 * These run the **real** generic load use-case against the fixture adapters —
 * the same use-case marketplace-admin runs over REST. So what is under test is
 * not the fixtures but the wiring: that a page can compose a context, run a
 * domain use-case, and get resolved entities back without a backend.
 */
describe('loadProducts', () => {
  it('returns the catalog with its classifications as ids', async () => {
    const page = await loadProducts({ pageSize: 100 });

    expect(page.total).toBe(9);

    const lamp = page.items.find(item => item.code === 'AUR-LAMP-01');
    // Both used to be links — one embedded, one a foreign key the use-case
    // followed through a resolver. Their targets live in another slice's store
    // now, so the specification carries ids and a caller that wants a name asks
    // the owning domain for it (ADR 0022).
    expect(lamp?.brandId).toBe('brand-aurora');
    expect(lamp?.categoryId).toBe('category-lighting');
  });

  it('filters by category code, not id', async () => {
    const page = await loadProducts({ category: 'tableware' });

    expect(page.items.map(item => item.code).sort()).toEqual([
      'TER-BOWL-01',
      'TER-MUG-01',
      'TER-PLAT-01',
    ]);
  });

  it('matches a search term against the name, case-insensitively', async () => {
    const page = await loadProducts({ search: 'LAMP' });

    expect(page.items.map(item => item.name)).toContain('Aurora Desk Lamp');
    expect(page.items.every(item => /lamp/i.test(item.name))).toBe(true);
  });

  it('sorts and pages', async () => {
    const first = await loadProducts({ sort: 'name', page: 1, pageSize: 2 });
    const second = await loadProducts({ sort: 'name', page: 2, pageSize: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(9);
    expect(first.items[0].name < first.items[1].name).toBe(true);
    expect(second.items[0].name > first.items[1].name).toBe(true);
  });

  it('sorts descending when asked', async () => {
    const page = await loadProducts({
      sort: 'name',
      direction: 'desc',
      pageSize: 2,
    });

    expect(page.items[0].name > page.items[1].name).toBe(true);
  });

  it('is empty for a category that does not exist', async () => {
    const page = await loadProducts({ category: 'nope' });

    expect(page.items).toEqual([]);
  });
});

describe('getProduct', () => {
  it('finds a product by the code the URL carries', async () => {
    const product = await getProduct('TER-MUG-01');

    expect(product?.name).toBe('Terra Ceramic Mug');
  });

  it('is undefined for an unknown code, so the route can 404', async () => {
    expect(await getProduct('NOPE-01')).toBeUndefined();
  });
});

describe('loadCategories', () => {
  it('returns every category, sorted by name', async () => {
    const page = await loadCategories();

    expect(page.items.map(item => item.code)).toEqual([
      'lighting',
      'tableware',
      'textiles',
    ]);
  });
});

describe('getBrand and getCategory', () => {
  /**
   * These replaced link resolution. A specification names its brand and category
   * by id into `catalog-reference` — another slice's store — so the name is
   * fetched through that domain's own read path rather than joined at the
   * storage layer (ADR 0022).
   */
  it('resolves a brand a specification names', async () => {
    const brand = await getBrand('brand-aurora');

    expect(brand?.name).toBe('Aurora');
  });

  it('resolves a category a specification names', async () => {
    const category = await getCategory('category-lighting');

    expect(category?.code).toBe('lighting');
  });

  it('is undefined for an id whose target is gone', async () => {
    // The case that matters: nothing enforces this reference across the store
    // boundary, so a dangling id is a display gap and every caller renders a
    // fallback rather than failing.
    expect(await getBrand('brand-deleted')).toBeUndefined();
    expect(await getCategory('category-deleted')).toBeUndefined();
  });

  it('short-circuits an unclassified specification without querying', async () => {
    expect(await getBrand(undefined)).toBeUndefined();
    expect(await getCategory(undefined)).toBeUndefined();
  });
});
