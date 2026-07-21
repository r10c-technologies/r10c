import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Product } from './product/product.entity.js';
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

  it('describes its columns with declared types and labels', () => {
    const columns = describeEntityColumns(ProductBrand);

    expect(columns.map((column) => [column.name, column.type, column.label])).toEqual([
      ['id', 'id', 'ID'],
      ['code', 'string', 'Code'],
      ['name', 'string', 'Name'],
      ['description', 'string', 'Description'],
      ['website', 'string', 'Website'],
    ]);
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
    expect(describeEntityColumns(ProductCategory).map((column) => column.name)).toEqual([
      'id',
      'code',
      'name',
      'description',
    ]);
  });
});

describe('Product', () => {
  const aProduct = () => {
    const product = new Product('P-1', 'Widget');
    product.id = 'p-1';
    product.description = 'A product';
    return product;
  };

  it('round-trips its scalar accessors', () => {
    const product = aProduct();
    product.code = 'P-2';
    product.name = 'Gadget';

    expect(serializeEntity(Product, product)).toMatchObject({
      id: 'p-1',
      code: 'P-2',
      name: 'Gadget',
      description: 'A product',
    });
  });

  // The links are initialized by the constructor and exposed read-only, which
  // is what lets the deserializer populate them in place rather than assigning
  // through a setter.
  it('initializes both relations as empty links', () => {
    const product = new Product('P-1', 'Widget');

    expect(product.brand.entityConstructor).toBe(ProductBrand);
    expect(product.category.entityConstructor).toBe(ProductCategory);
    expect(product.brand.isLoaded).toBe(false);
    expect(product.category.isLoaded).toBe(false);
  });

  it('serializes an embedded brand and a foreign-key category', () => {
    const product = aProduct();
    const brand = new ProductBrand('Acme');
    brand.id = 'b-1';
    product.brand.setValue(brand);
    product.category.setId('c-1');

    expect(serializeEntity(Product, product)).toMatchObject({
      brand: { id: 'b-1', name: 'Acme' },
      category: 'c-1',
    });
  });

  it('deserializes the mixed shape the catalog service sends', () => {
    const product = Effect.runSync(
      deserializeSingleEntity(Product, {
        id: 'p-1',
        code: 'P-1',
        name: 'Widget',
        brand: { id: 'b-1', name: 'Acme' },
        category: 'c-1',
      }),
    );

    expect(product?.brand.isLoaded).toBe(true);
    expect(product?.brand.value?.name).toBe('Acme');
    expect(product?.category.isLoaded).toBe(false);
    expect(product?.category.id).toBe('c-1');
  });

  it('describes links as neither sortable nor filterable', () => {
    const columns = describeEntityColumns(Product);
    const brand = columns.find((column) => column.name === 'brand');

    expect(brand).toMatchObject({
      type: 'link',
      label: 'Brand',
      sortable: false,
      filterable: false,
      linkLabelProperty: 'name',
    });
  });
});
