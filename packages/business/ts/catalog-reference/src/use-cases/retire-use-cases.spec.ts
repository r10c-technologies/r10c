import {
  describeEntityUseCases,
  type Entity,
  type EntityConstructor,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { ProductBrand } from '../entities/product-brand/product-brand.entity.js';
import { ProductCategory } from '../entities/product-category/product-category.entity.js';
import {
  RETIRE_PRODUCT_BRAND,
  RetireProductBrandUC,
} from './retire-product-brand/retire-product-brand.uc.js';
import {
  RETIRE_PRODUCT_CATEGORY,
  RetireProductCategoryUC,
} from './retire-product-category/retire-product-category.uc.js';
import { retireReferences } from './retire-reference/retire-reference.js';

/**
 * Widened to the base constructor: `describe.each` over two classes unions
 * their types, and what is asserted here is a property of the verb, which both
 * declare identically.
 */
const RETIRABLE: Array<
  [string, EntityConstructor<Entity>, { run: () => unknown }, string]
> = [
  ['product-brand', ProductBrand, RetireProductBrandUC, RETIRE_PRODUCT_BRAND],
  [
    'product-category',
    ProductCategory,
    RetireProductCategoryUC,
    RETIRE_PRODUCT_CATEGORY,
  ],
];

describe.each(RETIRABLE)(
  'retire on %s',
  (key, entityConstructor, uc, permission) => {
    const descriptor = () =>
      describeEntityUseCases(entityConstructor).find(
        one => one.key === 'retire',
      );

    it('is declared against the entity', () => {
      expect(descriptor()).toBeDefined();
    });

    /**
     * `collection`-bound is what makes this the bulk bar's rather than a form's:
     * its subject is a set. An entity-bound verb fanned out client-side would be
     * one request per row, and the "select all matching" case has no id list to
     * fan out over at all.
     */
    it('is bound to the collection, not to one record', () => {
      expect(descriptor()?.binding).toBe('collection');
    });

    /**
     * `context-dependent` — it needs something selected. A
     * `context-independent` collection verb sits in the toolbar and acts on the
     * whole collection, and retiring the entire vocabulary in one click is not an
     * affordance anybody wants.
     */
    it('needs a selection before it means anything', () => {
      expect(descriptor()?.placement).toBe('context-dependent');
    });

    /**
     * The tone describes the *consequence* — the record leaves every picker in
     * the marketplace — not the storage operation, which writes one member.
     */
    it('asks first, in the destructive tone', () => {
      expect(descriptor()?.confirm?.tone).toBe('destructive');
    });

    it('derives its permission from the declaration', () => {
      expect(permission).toBe(`catalog-reference:${key}:retire`);
    });

    /**
     * Both verbs run the same shared effect. They are two use cases rather than
     * one because a permission is per entity — an operator could be allowed to
     * retire brands and not categories — but the *rule* has no reason to differ.
     */
    it('runs the shared retire effect', () => {
      expect(uc.run()).toBe(retireReferences);
    });
  },
);
