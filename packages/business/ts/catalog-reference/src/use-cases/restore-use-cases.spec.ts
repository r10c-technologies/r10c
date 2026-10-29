import {
  describeEntityUseCases,
  type Entity,
  type EntityConstructor,
} from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { ProductBrand } from '../entities/product-brand/product-brand.entity.js';
import { ProductCategory } from '../entities/product-category/product-category.entity.js';
import {
  RESTORE_PRODUCT_BRAND,
  RestoreProductBrandUC,
} from './restore-product-brand/restore-product-brand.uc.js';
import {
  RESTORE_PRODUCT_CATEGORY,
  RestoreProductCategoryUC,
} from './restore-product-category/restore-product-category.uc.js';
import { retireReferences } from './retire-reference/retire-reference.js';

const RESTORABLE: Array<
  [string, EntityConstructor<Entity>, { run: () => unknown }, string]
> = [
  ['product-brand', ProductBrand, RestoreProductBrandUC, RESTORE_PRODUCT_BRAND],
  [
    'product-category',
    ProductCategory,
    RestoreProductCategoryUC,
    RESTORE_PRODUCT_CATEGORY,
  ],
];

describe.each(RESTORABLE)(
  'restore on %s',
  (key, entityConstructor, uc, permission) => {
    const descriptor = () =>
      describeEntityUseCases(entityConstructor).find(
        one => one.key === 'restore',
      );

    /**
     * Retire's other direction, over the same selection: a verb of its own
     * because the permission is, and because a restore needs no confirmation —
     * nothing it does is lost by retiring again.
     */
    it('is a bulk verb over a selection, with no confirmation', () => {
      expect(descriptor()).toMatchObject({
        binding: 'collection',
        placement: 'context-dependent',
        labelKey: `entity:${key}.useCases.restore`,
      });
      expect(descriptor()?.confirm).toBeUndefined();
    });

    it('derives its permission from the declaration', () => {
      expect(permission).toBe(`catalog-reference:${key}:restore`);
    });

    it('runs the shared retire effect, the other way', () => {
      expect(uc.run()).toBe(retireReferences);
    });
  },
);
