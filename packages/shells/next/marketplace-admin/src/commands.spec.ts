import { NEW_COMMAND_PAGE } from '@entifix/authz';
import { extractMetaEntity } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from './catalog-surfaces';
import { MARKETPLACE_ADMIN_COMMANDS } from './commands';

/**
 * Derived from the surface table, whose order `catalog-surfaces.spec.ts`
 * asserts once: each test states the derivation's rule, so a new surface is
 * one line in the table and none here (#773).
 */
const creatable = MARKETPLACE_ADMIN_CATALOG_SURFACES.filter(
  surface => extractMetaEntity(surface.entityConstructor).creatable,
);

describe('MARKETPLACE_ADMIN_COMMANDS', () => {
  it('derives one create command per creatable surface, in table order', () => {
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.key)).toEqual(
      creatable.map(surface => `new:${surface.entityKey}`),
    );
    // A read-only record — an import, written by its verb alone — has none.
    expect(creatable.length).toBeLessThan(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.length,
    );
  });

  it('routes to the create page the generated screens already serve', () => {
    // `${basePath}/new`, never the entity key: `product-specification` lives
    // at `/catalog/product`, which is the drift this derivation closes.
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.href)).toEqual(
      creatable.map(surface => `${surface.basePath}/new`),
    );
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.href)).toContain(
      '/catalog/product/new',
    );
  });

  it('names `write`, derived from each entity’s own decorator', () => {
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.permission)).toEqual(
      creatable.map(surface => {
        const { domain, key } = extractMetaEntity(surface.entityConstructor);
        return `${String(domain)}:${String(key)}:write`;
      }),
    );
  });

  it('titles each one from the entity’s own new-form heading', () => {
    // Not a verb interpolated with the label: Spanish inflects the adjective for
    // the noun's gender ("Nuevo producto", "Nueva marca"), so a shared template
    // is wrong for half of them.
    expect(MARKETPLACE_ADMIN_COMMANDS.map(c => c.labelKey)).toEqual(
      creatable.map(surface => `entity:${surface.entityKey}.form.newTitle`),
    );
  });

  it('carries the entitlement ceiling only where the surface declared one', () => {
    const entitled = MARKETPLACE_ADMIN_COMMANDS.filter(
      c => c.entitled === true,
    ).map(c => c.key);
    const surfaces = creatable
      .filter(s => s.entitled === true)
      .map(s => `new:${s.entityKey}`);

    expect(entitled).toEqual(surfaces);
  });

  it('sits on the create page rather than the root', () => {
    expect(
      MARKETPLACE_ADMIN_COMMANDS.every(c => c.page === NEW_COMMAND_PAGE),
    ).toBe(true);
  });
});
