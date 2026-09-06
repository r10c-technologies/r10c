import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_NAV } from './nav';

const items = MARKETPLACE_ADMIN_NAV.flatMap(section => section.items);

describe('MARKETPLACE_ADMIN_NAV', () => {
  it('offers one item per declared surface, in order', () => {
    // Derived, not written: adding a `CatalogSurface` adds the nav entry, which
    // is the half that used to be forgotten and left a screen unreachable.
    expect(items.map(item => item.href)).toEqual([
      '/catalog/product',
      '/catalog/product-brand',
      '/catalog/product-category',
    ]);
  });

  it('guards each item with the permission its own entity derives', () => {
    // Two domains, neither written out here. A hand-typed domain string could
    // name something the route behind it does not check.
    expect(items.map(item => item.permission)).toEqual([
      'product-configuration-management:product-specification:read',
      'catalog-reference:product-brand:read',
      'catalog-reference:product-category:read',
    ]);
  });

  it('addresses every item’s workspace tab under the master type', () => {
    expect(items.map(item => item.workspace)).toEqual([
      'master:product-specification',
      'master:product-brand',
      'master:product-category',
    ]);
  });

  it('entitlement-gates the tenant-plane surface and nothing else', () => {
    // Nobody is provisioned for `catalog-reference`, so gating brands or
    // categories would hide the platform's own vocabulary from every vendor.
    expect(items.map(item => item.entitled)).toEqual([true, undefined, undefined]);
  });

  it('types the section as Definiciones', () => {
    expect(MARKETPLACE_ADMIN_NAV.map(section => section.type)).toEqual([
      'master',
    ]);
  });

  it('names copy in the shared shell namespace', () => {
    // An `app:` key is lint-restricted to `apps/`, so a shell binding one would
    // fail the build — and a second host would have to re-translate.
    const keys = MARKETPLACE_ADMIN_NAV.flatMap(section => [
      section.title,
      ...section.items.map(item => item.label),
    ]);

    expect(keys.every(key => key?.startsWith('shell:') === true)).toBe(true);
  });
});
