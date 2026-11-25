import { NEW_COMMAND_PAGE } from '@entifix/authz';
import { extractMetaEntity } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from './catalog-surfaces';
import { MARKETPLACE_ADMIN_COMMANDS } from './commands';

describe('MARKETPLACE_ADMIN_COMMANDS', () => {
  it('derives one create command per creatable surface, so a sixth entity needs no line', () => {
    expect(MARKETPLACE_ADMIN_COMMANDS).toHaveLength(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.filter(
        surface => extractMetaEntity(surface.entityConstructor).creatable,
      ).length,
    );
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.key)).toEqual([
      'new:product-specification',
      'new:product-offering',
      'new:product-offering-price',
      'new:product-brand',
      'new:product-category',
      'new:device-model',
    ]);
  });

  it('routes to the create page the generated screens already serve', () => {
    // `${basePath}/new`, with the slug the factory owns rather than a literal —
    // and `product-specification` lives at `/catalog/product`, which is the
    // drift this derivation closes.
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.href)).toEqual([
      '/catalog/product/new',
      '/catalog/product-offering/new',
      '/catalog/product-offering-price/new',
      '/catalog/product-brand/new',
      '/catalog/product-category/new',
      '/catalog/device-model/new',
    ]);
  });

  it('names `write`, derived from each entity’s own decorator', () => {
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.permission)).toEqual([
      'product-configuration-management:product-specification:write',
      'product-configuration-management:product-offering:write',
      'product-configuration-management:product-offering-price:write',
      'catalog-reference:product-brand:write',
      'catalog-reference:product-category:write',
      'catalog-reference:device-model:write',
    ]);
  });

  it('titles each one from the entity’s own new-form heading', () => {
    // Not a verb interpolated with the label: Spanish inflects the adjective for
    // the noun's gender ("Nuevo producto", "Nueva marca"), so a shared template
    // is wrong for half of them.
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.labelKey)).toEqual([
      'entity:product-specification.form.newTitle',
      'entity:product-offering.form.newTitle',
      'entity:product-offering-price.form.newTitle',
      'entity:product-brand.form.newTitle',
      'entity:product-category.form.newTitle',
      'entity:device-model.form.newTitle',
    ]);
  });

  it('carries the entitlement ceiling only where the surface declared one', () => {
    const entitled = MARKETPLACE_ADMIN_COMMANDS.filter(
      c => c.entitled === true,
    ).map(c => c.key);
    // A catalog import is entitled but written by its verb alone: no command.
    const surfaces = MARKETPLACE_ADMIN_CATALOG_SURFACES.filter(
      s => s.entitled === true && s.entityKey !== 'catalog-import',
    ).map(s => `new:${s.entityKey}`);

    expect(entitled).toEqual(surfaces);
  });

  it('sits on the create page rather than the root', () => {
    expect(
      MARKETPLACE_ADMIN_COMMANDS.every(c => c.page === NEW_COMMAND_PAGE),
    ).toBe(true);
  });
});
