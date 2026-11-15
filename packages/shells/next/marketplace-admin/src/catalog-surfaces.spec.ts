import { accessor, type Entity, entity } from '@entifix/core';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { describe, expect, it } from 'vitest';

import {
  catalogSurface,
  MARKETPLACE_ADMIN_CATALOG_SURFACES,
  permissionForSurface,
  PRODUCT_BRAND_SURFACE,
  PRODUCT_CATEGORY_SURFACE,
  PRODUCT_OFFERING_PRICE_SURFACE,
  PRODUCT_OFFERING_SURFACE,
  PRODUCT_SURFACE,
  surfaceListAddress,
  surfaceRecordAddress,
} from './catalog-surfaces';

describe('the catalog surfaces', () => {
  it('declares the five the back office serves, in nav order', () => {
    expect(MARKETPLACE_ADMIN_CATALOG_SURFACES.map(s => s.entityKey)).toEqual([
      'product-specification',
      'product-offering',
      'product-offering-price',
      'product-brand',
      'product-category',
    ]);
  });

  it('reads each entity’s plural from its own decorator', () => {
    // Not rebuilt from the key: a second place that knows how an entity's
    // catalog subtree is laid out is a second place to fix when one moves.
    expect(PRODUCT_SURFACE.entityPluralKey).toBe(
      'entity:product-specification.plural',
    );
    expect(PRODUCT_BRAND_SURFACE.entityPluralKey).toBe(
      'entity:product-brand.plural',
    );
    expect(PRODUCT_CATEGORY_SURFACE.entityPluralKey).toBe(
      'entity:product-category.plural',
    );
  });

  it('keeps the route separate from the entity key where they differ', () => {
    // `/catalog/product` for `product-specification`. These two have drifted
    // apart once already, and the tab that resulted resolved to nothing.
    expect(PRODUCT_SURFACE.basePath).toBe('/catalog/product');
    expect(PRODUCT_BRAND_SURFACE.basePath).toBe('/catalog/product-brand');
  });

  it('names each backend symbolically, never as a URL', () => {
    // A resolved address here would reach the browser through the client
    // barrel, or freeze the build-time value into it.
    expect(PRODUCT_SURFACE.service).toBe('marketplace-admin');
    expect(PRODUCT_BRAND_SURFACE.service).toBe('marketplace');
    expect(PRODUCT_CATEGORY_SURFACE.service).toBe('marketplace');
  });

  it('gates the tenant-plane surfaces on entitlement, and only those', () => {
    // `catalog-reference` is never grantable (ADR 0022), so gating brands or
    // categories would hide the platform's own vocabulary from every vendor.
    expect(PRODUCT_SURFACE.entitled).toBe(true);
    expect(PRODUCT_OFFERING_SURFACE.entitled).toBe(true);
    expect(PRODUCT_OFFERING_PRICE_SURFACE.entitled).toBe(true);
    expect(PRODUCT_BRAND_SURFACE.entitled).toBeUndefined();
    expect(PRODUCT_CATEGORY_SURFACE.entitled).toBeUndefined();
  });

  /**
   * A price is found and named through the offering it prices: the term is
   * matched against the offering's name, and the prices referring to the
   * matches are listed under it (#552). No label member of its own.
   */
  it('searches a price through the offering it prices', () => {
    expect(PRODUCT_OFFERING_PRICE_SURFACE.searchProperty).toBe('offeringId');
    expect(PRODUCT_OFFERING_PRICE_SURFACE.labelProperty).toBeUndefined();
    expect(PRODUCT_OFFERING_PRICE_SURFACE.reference).toEqual({
      entityConstructor: ProductOffering,
      service: 'marketplace-admin',
    });
  });

  it('carries r10c-namespaced nav copy', () => {
    // `app:` keys are a lint error outside `apps/`, and this is a shell; the
    // framework's `shell:` namespace no longer carries r10c's copy.
    for (const surface of MARKETPLACE_ADMIN_CATALOG_SURFACES) {
      expect(surface.navLabelKey.startsWith('r10c:')).toBe(true);
    }
  });
});

describe('catalogSurface', () => {
  it('rejects an entity that declares no plural key', () => {
    // `pluralKey` is optional on `MetaEntityOptions`, and a surface without one
    // titles its search group `undefined` on the first keystroke — a failure
    // that surfaces as "this group is broken" rather than "this is undeclared".
    @entity({ domain: 'catalog-reference', key: 'product-category' })
    class Unnamed implements Entity {
      #id?: string;

      @accessor({ type: 'id', label: 'ID' })
      get id(): string | undefined {
        return this.#id;
      }
      set id(value: string | undefined) {
        this.#id = value;
      }
    }

    expect(() =>
      catalogSurface(Unnamed, {
        entityKey: 'product-category',
        basePath: '/catalog/product-category',
        icon: '⊞',
        navLabelKey: 'r10c:marketplaceAdmin.nav.categories',
        service: 'marketplace',
        searchProperty: 'name',
        labelProperty: 'name',
      }),
    ).toThrow(/pluralKey/);
  });
});

describe('permissionForSurface', () => {
  it('derives the permission from the entity’s own domain and key', () => {
    // Two domains, from two packages, and neither is written out here.
    expect(permissionForSurface(PRODUCT_SURFACE)).toBe(
      'product-configuration-management:product-specification:read',
    );
    expect(permissionForSurface(PRODUCT_BRAND_SURFACE)).toBe(
      'catalog-reference:product-brand:read',
    );
  });
});

describe('the workspace addresses', () => {
  it('addresses a list by the entity key, under the master type', () => {
    expect(surfaceListAddress(PRODUCT_SURFACE)).toBe(
      'master:product-specification',
    );
  });

  it('addresses a record by appending its id', () => {
    expect(surfaceRecordAddress(PRODUCT_BRAND_SURFACE, 'b-1')).toBe(
      'master:product-brand:b-1',
    );
  });
});
