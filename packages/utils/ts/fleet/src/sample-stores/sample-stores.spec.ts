import { describe, expect, it } from 'vitest';

import {
  HARDWARE_STORE,
  PHONE_ACCESSORIES_STORE,
  sampleMediaPath,
  SEEDED_VENDORS,
  SHOEMAKING_SUPPLIES_STORE,
} from '../seeded-vendors.js';
import {
  SAMPLE_BRAND_IDS,
  SAMPLE_BRANDS,
  SAMPLE_CATEGORIES,
  SAMPLE_CATEGORY_IDS,
  sampleCategory,
} from './catalog-reference.js';
import { product } from './product.js';

const everyProduct = SEEDED_VENDORS.flatMap(vendor =>
  vendor.products.map(item => ({ vendor, item })),
);

/** Scale-0 units count whole pieces; the rest are thousandths. */
const WHOLE: Record<string, number> = {
  UN: 1,
  PAR: 1,
  M: 1000,
  YD: 1000,
  LB: 1000,
  L: 1000,
};

describe('the sample stores', () => {
  it('are three, one per vertical, each a flagged sample', () => {
    expect(SEEDED_VENDORS.map(vendor => vendor.vertical)).toEqual([
      'hardware',
      'phone-accessories',
      'shoemaking-supplies',
    ]);
    expect(SEEDED_VENDORS.every(vendor => vendor.sampleStore)).toBe(true);
    expect(
      new Set(SEEDED_VENDORS.map(vendor => vendor.fiscal.taxRegime)).size,
    ).toBe(3);
  });

  it('give every store its own id prefix, organization, slug and NIT', () => {
    // One published catalog keyed by offering id: a shared prefix would make
    // two stores' publications overwrite each other.
    for (const read of [
      (vendor: (typeof SEEDED_VENDORS)[number]) => vendor.idPrefix,
      vendor => vendor.organizationId,
      vendor => vendor.slug,
      vendor => vendor.fiscal.taxId,
    ] satisfies ((vendor: (typeof SEEDED_VENDORS)[number]) => string)[]) {
      const values = SEEDED_VENDORS.map(read);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('name only brands and categories the vocabulary declares', () => {
    for (const { item } of everyProduct) {
      expect(SAMPLE_BRAND_IDS[item.brand]).toBeDefined();
      expect(SAMPLE_CATEGORY_IDS[item.category]).toBeDefined();
      expect(sampleCategory(item.category).retired).toBeUndefined();
    }
  });

  it('keep keys and names unique within a store', () => {
    for (const vendor of SEEDED_VENDORS) {
      for (const read of [
        (item: (typeof vendor.products)[number]) => item.key,
        item => item.name,
      ] satisfies ((item: (typeof vendor.products)[number]) => string)[]) {
        const values = vendor.products.map(read);
        expect(new Set(values).size).toBe(values.length);
      }
    }
  });

  it('state a sellable rule and a positive price on every product', () => {
    for (const { item } of everyProduct) {
      expect(Number.isInteger(item.step) && item.step > 0).toBe(true);
      expect(item.minimum % item.step).toBe(0);
      expect(Number.isInteger(item.amount) && item.amount > 0).toBe(true);
      expect(WHOLE[item.unit]).toBeDefined();
      if (typeof item.stock === 'number') {
        expect(item.stock).toBeGreaterThan(0);
      }
    }
  });

  it('give each store a published, stocked offering sold by the piece', () => {
    // What a journey buying from a store needs (fleet-e2e `sellable`).
    for (const vendor of SEEDED_VENDORS) {
      expect(
        vendor.products.some(
          item =>
            item.status === 'published' &&
            item.unit === 'UN' &&
            item.pricePer === 1 &&
            typeof item.stock === 'number',
        ),
      ).toBe(true);
    }
  });

  it('show every status and both empty stock paths in every store', () => {
    for (const vendor of SEEDED_VENDORS) {
      const statuses = new Set(vendor.products.map(item => item.status));
      expect([...statuses].sort()).toEqual([
        'draft',
        'pending-review',
        'published',
        'unpublished',
      ]);
      const stocks = vendor.products.map(item => item.stock);
      expect(stocks).toContain('sold-out');
      expect(stocks).toContain('none');
    }
  });

  it('sell hardware by the metre and per hundred, and leather by the yard', () => {
    const published = (vendor: (typeof SEEDED_VENDORS)[number]) =>
      vendor.products.filter(
        item => item.status === 'published' && typeof item.stock === 'number',
      );
    expect(published(HARDWARE_STORE).some(item => item.unit === 'M')).toBe(
      true,
    );
    expect(published(HARDWARE_STORE).some(item => item.pricePer === 100)).toBe(
      true,
    );
    expect(
      published(SHOEMAKING_SUPPLIES_STORE).some(item => item.unit === 'YD'),
    ).toBe(true);
  });

  it('fit every phone accessory to at least one seeded model', () => {
    for (const item of PHONE_ACCESSORIES_STORE.products) {
      expect(item.fits?.length).toBeGreaterThan(0);
      for (const id of item.fits ?? []) {
        expect(id).toMatch(/^device-model-(?:[1-9]|1[0-3])$/);
      }
    }
  });

  it('serve every picture from the platform, never a third party', () => {
    expect(sampleMediaPath(HARDWARE_STORE, { key: 'martillo-16' })).toBe(
      '/samples/ferreteria-el-martillo/martillo-16.svg',
    );
  });

  it('defaults a product to one piece priced for one', () => {
    expect(
      product({
        key: 'k',
        name: 'n',
        description: 'd',
        brand: 'cobrelux',
        category: 'cables',
        art: 'cable',
        amount: 1,
        status: 'draft',
        stock: 'none',
      }),
    ).toMatchObject({ unit: 'UN', step: 1, minimum: 1, pricePer: 1 });
  });
});

describe('the sample vocabulary', () => {
  it('numbers brands and categories by position', () => {
    expect(SAMPLE_BRAND_IDS['cobrelux']).toBe('product-brand-1');
    expect(SAMPLE_CATEGORY_IDS['hardware']).toBe('product-category-1');
    expect(Object.keys(SAMPLE_BRAND_IDS)).toHaveLength(SAMPLE_BRANDS.length);
  });

  it('roots every category in an active one, at most five deep', () => {
    for (const [key, category] of SAMPLE_CATEGORIES) {
      let depth = 1;
      let parent = category.parent;
      while (parent !== undefined) {
        const above = sampleCategory(parent);
        if (category.retired === undefined) {
          expect(above.retired, `${key} under ${parent}`).toBeUndefined();
        }
        parent = above.parent;
        depth += 1;
      }
      expect(depth).toBeLessThanOrEqual(5);
    }
  });

  it('refuses a category key nobody declared', () => {
    expect(() => sampleCategory('nothing')).toThrow(/nothing/);
  });
});
