import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductSpecification } from './product-specification.entity.js';

describe('ProductSpecification', () => {
  const aSpecification = () => {
    const specification = new ProductSpecification('P-1', 'Widget');
    specification.id = 'p-1';
    specification.description = 'A product';
    return specification;
  };

  it('round-trips its scalar accessors', () => {
    const specification = aSpecification();
    specification.code = 'P-2';
    specification.name = 'Gadget';

    expect(serializeEntity(ProductSpecification, specification)).toMatchObject({
      id: 'p-1',
      code: 'P-2',
      name: 'Gadget',
      description: 'A product',
    });
  });

  it('carries brand and category as plain ids', () => {
    const specification = aSpecification();
    specification.brandId = 'product-brand-1';
    specification.categoryId = 'product-category-1';

    expect(serializeEntity(ProductSpecification, specification)).toMatchObject({
      brandId: 'product-brand-1',
      categoryId: 'product-category-1',
    });
  });

  it('deserializes the shape the catalog service sends', () => {
    const specification = Effect.runSync(
      deserializeSingleEntity(ProductSpecification, {
        id: 'p-1',
        code: 'P-1',
        name: 'Widget',
        brandId: 'product-brand-1',
        categoryId: 'product-category-1',
      }),
    );

    expect(specification?.brandId).toBe('product-brand-1');
    expect(specification?.categoryId).toBe('product-category-1');
  });

  it('leaves both classifications unset when the payload omits them', () => {
    // A dangling or absent reference is a display gap, never a broken record —
    // which is the point of not enforcing a foreign key across a store boundary.
    const specification = new ProductSpecification('P-1', 'Widget');

    expect(specification.brandId).toBeUndefined();
    expect(specification.categoryId).toBeUndefined();
  });

  it('declares no `link` member, because the targets are another slice’s store', () => {
    // `ProductBrand` and `ProductCategory` live in `catalog-reference` —
    // platform plane, different store, different writing slice. A typed
    // `EntityLink` would need a `business:domain` → `business:domain` import,
    // which the boundary rule fails the build on, and it would resolve the
    // relation at the storage layer across a store boundary. Both are the
    // coupling the split exists to prevent (ADR 0022).
    const types = describeEntityColumns(ProductSpecification).map(
      column => column.type,
    );

    expect(types).not.toContain('link');
    expect(types).not.toContain('linkCollection');
  });

  it('makes both classifications filterable, since the vendor lists by them', () => {
    // Member metadata is also the server-side filter allowlist, so "every
    // specification in this category" depends on this being declared.
    const byName = new Map(
      describeEntityColumns(ProductSpecification).map(column => [
        column.name,
        column,
      ]),
    );

    expect(byName.get('brandId')?.filterable).toBe(true);
    expect(byName.get('categoryId')?.filterable).toBe(true);
  });

  // The member the back office's record search matches a term against. Declared
  // rather than inherited from the scalar default, because the flag is also the
  // server-side RSQL allowlist and losing it is silent at both ends.
  it('declares name filterable, because that is what record search matches', () => {
    const name = describeEntityColumns(ProductSpecification).find(
      column => column.name === 'name',
    );

    expect(name?.filterable).toBe(true);
  });
});
