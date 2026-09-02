import {
  describeEntityColumns,
  type Entity,
  type EntityConstructor,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { ReferenceStatuses } from '../values/reference-status.js';
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
      status: 'active',
    });
  });

  it('takes its name from the constructor and omits what was never set', () => {
    // `status` is the exception, and deliberately so: it has a default rather
    // than being optional, because a brand with no lifecycle state is not a
    // meaningful record — every picker would have to decide what an absent
    // status means, and they would not all decide the same way.
    expect(serializeEntity(ProductBrand, new ProductBrand('Acme'))).toEqual({
      name: 'Acme',
      status: 'active',
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
      ['status', 'enum', 'Status'],
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
      status: 'active',
    });
  });

  it('describes its columns with declared types and labels', () => {
    expect(
      describeEntityColumns(ProductCategory).map(column => column.name),
    ).toEqual(['id', 'code', 'name', 'description', 'status']);
  });

  /** Same contract, same silent failure. See the sibling on `ProductBrand`. */
  it('declares `name` filterable, because that is what a picker searches', () => {
    const name = describeEntityColumns(ProductCategory).find(
      column => column.name === 'name',
    );

    expect(name?.filterable).toBe(true);
  });
});

/**
 * Widened to the base constructor deliberately: `it.each` over two classes
 * unions their types, and the union is not assignable to either one's generic
 * parameter. What is being asserted is a property of the *lifecycle*, which
 * both entities share, so the base type is the honest one to state it against.
 */
const LIFECYCLE_ENTITIES: Array<[string, EntityConstructor<Entity>]> = [
  ['ProductBrand', ProductBrand],
  ['ProductCategory', ProductCategory],
];

describe('the reference lifecycle', () => {
  /**
   * Retiring is not deleting, and the member is what carries the difference.
   * A specification in another slice's store holds a bare `brandId` /
   * `categoryId` with nothing enforcing the reference (ADR 0022), so removing
   * the row leaves every offering classified under it pointing at nothing.
   */
  it('starts both entities active', () => {
    expect(new ProductBrand('Acme').status).toBe('active');
    expect(new ProductCategory('CAT', 'Category').status).toBe('active');
  });

  /**
   * `filterable`, because the first thing an operator does on this screen is
   * narrow it to what is still active — and the flag is simultaneously the
   * server-side RSQL allowlist, so losing it answers `400`.
   */
  it.each(LIFECYCLE_ENTITIES)(
    'declares %s status filterable',
    (_name, entityConstructor) => {
      const status = describeEntityColumns(entityConstructor).find(
        column => column.name === 'status',
      );

      expect(status?.filterable).toBe(true);
      expect(status?.enumValues).toEqual(ReferenceStatuses);
    },
  );

  it('round-trips a retired state through the setter', () => {
    const brand = new ProductBrand('Acme');
    const category = new ProductCategory('CAT', 'Category');

    brand.status = 'retired';
    category.status = 'retired';

    expect([brand.status, category.status]).toEqual(['retired', 'retired']);
  });

  /** One vocabulary for both: the same state, retired on the same screen. */
  it.each(LIFECYCLE_ENTITIES)(
    'points %s status at the shared label vocabulary',
    (_name, entityConstructor) => {
      const status = describeEntityColumns(entityConstructor).find(
        column => column.name === 'status',
      );

      expect(status?.enumLabelKey).toBe('entity:reference-status');
    },
  );
});
