import { RecordValidationError } from '@entifix/core';
import type { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CATALOG_ROWS, catalogFixtures } from './catalog-fixtures.js';

const { offerings, brands, categories, vendors } = CATALOG_ROWS;

const distinct = (member: string, rows = offerings) =>
  new Set(rows.map(row => row[member]).filter(value => value !== undefined));

describe('catalogFixtures', () => {
  it('serves every row of every set, validated', async () => {
    const fixtures = catalogFixtures();
    const count = (repository: typeof fixtures.offerings) =>
      Effect.runPromise(
        repository
          .load({ page: 1, pageSize: 100 })
          .pipe(Effect.map(page => page.items.length)),
      );

    expect(await count(fixtures.offerings)).toBe(offerings.length);
    expect(await count(fixtures.brands)).toBe(brands.length);
    expect(await count(fixtures.categories)).toBe(categories.length);
    expect(await count(fixtures.vendors)).toBe(vendors.length);
  });

  it('hands out entities, dates parsed', async () => {
    const lamp = await Effect.runPromise(
      catalogFixtures().offerings.get<PublishedOffering>(
        'offering-aurora-desk-lamp',
      ),
    );

    expect(lamp.publishedAt).toBeInstanceOf(Date);
    expect(lamp.media).toHaveLength(2);
  });

  it('refuses a row its metadata refuses', () => {
    const broken = { ...offerings[0], amount: 'nineteen' };

    expect(() =>
      catalogFixtures({ ...CATALOG_ROWS, offerings: [broken] }),
    ).toThrow(RecordValidationError);
  });

  it.each([
    [
      'offerings',
      'brandId',
      { ...offerings[0], id: 'broken', brandId: 'brand-missing' },
    ],
    [
      'offerings',
      'categoryId',
      { ...offerings[0], id: 'broken', categoryId: 'category-missing' },
    ],
    [
      'offerings',
      'vendorId',
      { ...offerings[0], id: 'broken', vendorId: 'vendor-missing' },
    ],
    [
      'categories',
      'parentId',
      { ...categories[0], id: 'broken', parentId: 'category-missing' },
    ],
  ] as const)('refuses %s naming a %s no row has', (set, member, row) => {
    // Added beside the real rows, so the one problem is the one planted.
    const rows = { ...CATALOG_ROWS, [set]: [...CATALOG_ROWS[set], row] };

    expect(() => catalogFixtures(rows)).toThrow(
      new RegExp(
        `${member} names ${String((row as Record<string, unknown>)[member])}`,
      ),
    );
  });
});

/**
 * What the set is for, pinned: a fixture edit that quietly drops one of these
 * leaves a facet, a page or a state with nothing to show.
 */
describe('the fixture catalog', () => {
  it('is big enough to page, with several vendors and brands', () => {
    expect(offerings.length).toBeGreaterThanOrEqual(30);
    expect(distinct('vendorId').size).toBeGreaterThanOrEqual(3);
    expect(distinct('brandId').size).toBeGreaterThanOrEqual(5);
  });

  it('prices in two currencies, across bands', () => {
    expect(distinct('currency')).toEqual(new Set(['GTQ', 'USD']));
    const amounts = offerings.map(row => row['amount'] as number);
    expect(Math.min(...amounts)).toBeLessThan(1000);
    expect(Math.max(...amounts)).toBeGreaterThan(100000);
  });

  it('holds a tree three levels deep', () => {
    const parentOf = new Map(
      categories.map(row => [row['id'], row['parentId']] as const),
    );
    const depth = (id: unknown): number =>
      id === undefined ? 0 : 1 + depth(parentOf.get(id));

    expect(Math.max(...categories.map(row => depth(row['id'])))).toBe(3);
  });

  it('keeps a retired brand and a retired category, with nothing under them', () => {
    const retired = (rows: typeof brands) =>
      rows.filter(row => row['status'] === 'retired').map(row => row['id']);

    expect(retired(brands)).toEqual(['brand-antigua']);
    expect(retired(categories)).toEqual(['category-archive']);
    expect(distinct('brandId').has('brand-antigua')).toBe(false);
    expect(distinct('categoryId').has('category-archive')).toBe(false);
  });

  it.each(['code', 'description', 'brandId', 'categoryId', 'media'])(
    'leaves %s out of some offerings',
    member => {
      expect(offerings.some(row => !(member in row))).toBe(true);
      expect(offerings.some(row => member in row)).toBe(true);
    },
  );

  it('marks some offerings out of stock', () => {
    expect(distinct('availableHint')).toEqual(new Set([true, false]));
  });

  it('keeps the rows the storefront journeys name', () => {
    const ids = distinct('id');

    for (const id of [
      'offering-aurora-desk-lamp',
      'offering-aurora-floor-lamp',
      'offering-terra-ceramic-mug',
    ]) {
      expect(ids).toContain(id);
    }
    expect(distinct('code', categories)).toContain('desk-lamps');
  });
});
