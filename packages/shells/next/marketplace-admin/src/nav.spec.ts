import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_NAV } from './nav';

const items = MARKETPLACE_ADMIN_NAV.flatMap(section => section.items);

describe('MARKETPLACE_ADMIN_NAV', () => {
  it('offers one item per declared surface, in order', () => {
    // Derived, not written: adding a `CatalogSurface` adds the nav entry, which
    // is the half that used to be forgotten and left a screen unreachable.
    expect(items.map(item => item.href)).toEqual([
      '/catalog/product',
      '/catalog/product-offering',
      '/catalog/product-offering-price',
      '/catalog/product-brand',
      '/catalog/product-category',
      '/wizards/product-setup',
    ]);
  });

  it('guards each item with the permission its own entity derives', () => {
    // Two domains, neither written out here. A hand-typed domain string could
    // name something the route behind it does not check.
    expect(items.map(item => item.permission)).toEqual([
      'product-configuration-management:product-specification:read',
      'product-configuration-management:product-offering:read',
      'product-configuration-management:product-offering-price:read',
      'catalog-reference:product-brand:read',
      'catalog-reference:product-category:read',
      // `write`, because the flow's whole purpose is to create the record.
      // Offering it to someone who may only read is offering a dead end.
      'product-configuration-management:product-specification:write',
    ]);
  });

  it('addresses every item’s workspace tab under its own screen type', () => {
    expect(items.map(item => item.workspace)).toEqual([
      'master:product-specification',
      'master:product-offering',
      'master:product-offering-price',
      'master:product-brand',
      'master:product-category',
      'wizard:product-setup',
    ]);
  });

  it('entitlement-gates the tenant-plane surfaces and nothing else', () => {
    // Nobody is provisioned for `catalog-reference`, so gating brands or
    // categories would hide the platform's own vocabulary from every vendor.
    expect(items.map(item => item.entitled)).toEqual([
      true,
      true,
      true,
      undefined,
      undefined,
      // The wizard authors a record in the same tenant-plane domain, so it
      // carries the same gate the products catalog does.
      true,
    ]);
  });

  it('types its sections as Definiciones and Asistentes', () => {
    // Contributing a `wizard` section is the whole of what makes the Asistentes
    // tier appear: the sidebar groups by `screenTypeRank` and needs no change.
    expect(MARKETPLACE_ADMIN_NAV.map(section => section.type)).toEqual([
      'master',
      'wizard',
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
