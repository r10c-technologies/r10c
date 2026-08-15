import { describeEntityColumns, serializeEntity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { ProductBrand } from './product-brand/product-brand.entity.js';
import { ProductCategory } from './product-category/product-category.entity.js';

describe('ProductBrand', () => {
  it('round-trips every accessor through its setter', () => {
    const brand = new ProductBrand('Acme');
    brand.id = 'b-1';
    brand.code = 'ACME';
    brand.description = 'A brand';
    brand.website = 'https://acme.test';

    expect(serializeEntity(ProductBrand, brand)).toEqual({
      id: 'b-1',
      code: 'ACME',
      name: 'Acme',
      description: 'A brand',
      website: 'https://acme.test',
    });
  });

  it('takes its name from the constructor and omits what was never set', () => {
    expect(serializeEntity(ProductBrand, new ProductBrand('Acme'))).toEqual({
      name: 'Acme',
    });
  });

  it('renames through the setter a repository writes back with', () => {
    const brand = new ProductBrand('Acme');
    brand.name = 'Acme Corp';

    expect(brand.name).toBe('Acme Corp');
  });

  it('describes its columns with declared types and labels', () => {
    const columns = describeEntityColumns(ProductBrand);

    expect(
      columns.map(column => [column.name, column.type, column.label]),
    ).toEqual([
      ['id', 'id', 'ID'],
      ['code', 'string', 'Code'],
      ['name', 'string', 'Name'],
      ['description', 'string', 'Description'],
      ['website', 'string', 'Website'],
    ]);
  });

  it('declares `name` filterable, because that is what a picker searches', () => {
    // `ProductSpecification.brandId` is a bare id into this store — a typed link
    // across the slice boundary is not a legal edge (ADR 0022) — so the admin
    // form's picker finds a brand with a `like` query on `name`. The same flag is
    // the server-side RSQL allowlist, and losing it fails silently at both ends:
    // marketplace-service answers `400`, and the picker renders that as an empty
    // suggestion list that reads as "there are no brands".
    const name = describeEntityColumns(ProductBrand).find(
      column => column.name === 'name',
    );

    expect(name?.filterable).toBe(true);
  });
});

describe('ProductCategory', () => {
  it('round-trips every accessor through its setter', () => {
    const category = new ProductCategory('CAT', 'Category');
    category.id = 'c-1';
    category.code = 'OTHER';
    category.name = 'Renamed';
    category.description = 'A category';

    expect(serializeEntity(ProductCategory, category)).toEqual({
      id: 'c-1',
      code: 'OTHER',
      name: 'Renamed',
      description: 'A category',
    });
  });

  it('describes its columns with declared types and labels', () => {
    expect(
      describeEntityColumns(ProductCategory).map(column => column.name),
    ).toEqual(['id', 'code', 'name', 'description']);
  });

  /** Same contract, same silent failure. See the sibling on `ProductBrand`. */
  it('declares `name` filterable, because that is what a picker searches', () => {
    const name = describeEntityColumns(ProductCategory).find(
      column => column.name === 'name',
    );

    expect(name?.filterable).toBe(true);
  });
});
