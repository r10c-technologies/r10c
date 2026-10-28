import type { EntityRepository } from '@entifix/business';
import type { EntityRecordRule } from '@entifix/core';
import { staticRepositoryFromRecords } from '@entifix/static';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';

import brands from './data/brands.json' with { type: 'json' };
import categories from './data/categories.json' with { type: 'json' };
import offerings from './data/offerings.json' with { type: 'json' };
import vendors from './data/vendors.json' with { type: 'json' };

type Rows = readonly Readonly<Record<string, unknown>>[];

/** The catalog every storefront fixture reads, in the entity wire shape. */
export interface CatalogRows {
  readonly offerings: Rows;
  readonly brands: Rows;
  readonly categories: Rows;
  readonly vendors: Rows;
}

export const CATALOG_ROWS: CatalogRows = {
  offerings,
  brands,
  categories,
  vendors,
};

/** One static repository per collection, each over validated rows. */
export interface CatalogFixtures {
  readonly offerings: EntityRepository;
  readonly brands: EntityRepository;
  readonly categories: EntityRepository;
  readonly vendors: EntityRepository;
}

const idsOf = (rows: Rows): ReadonlySet<unknown> =>
  new Set(rows.map(row => row['id']));

/**
 * `member`, when present, names a row of `targets`.
 *
 * The metadata cannot check these: `brandId`, `categoryId`, `vendorId` and
 * `parentId` are bare ids rather than `link`s, because each crosses into
 * another store (or, for `parentId`, the same collection), so
 * `linkTargets` never sees them.
 */
const referencesIn =
  (member: string, targets: Rows): EntityRecordRule =>
  (records, report) => {
    const known = idsOf(targets);
    records.forEach((record, index) => {
      const value = record[member];
      if (value !== undefined && !known.has(value)) {
        report(index, member, `names ${String(value)}, which no row has`);
      }
    });
  };

/**
 * The fixture catalog as static repositories, validated against each entity's
 * metadata and against one another, so a broken row throws a
 * `InvalidRecords` naming every problem before anything renders.
 *
 * `rows` defaults to the JSON beside this file; a spec passes its own to show
 * what a broken row does.
 */
export const catalogFixtures = (
  rows: CatalogRows = CATALOG_ROWS,
): CatalogFixtures => ({
  offerings: staticRepositoryFromRecords(PublishedOffering, rows.offerings, {
    source: 'offerings.json',
    rules: [
      referencesIn('brandId', rows.brands),
      referencesIn('categoryId', rows.categories),
      referencesIn('vendorId', rows.vendors),
    ],
  }),
  brands: staticRepositoryFromRecords(ProductBrand, rows.brands, {
    source: 'brands.json',
  }),
  categories: staticRepositoryFromRecords(ProductCategory, rows.categories, {
    source: 'categories.json',
    rules: [referencesIn('parentId', rows.categories)],
  }),
  vendors: staticRepositoryFromRecords(PublishedVendor, rows.vendors, {
    source: 'vendors.json',
  }),
});
