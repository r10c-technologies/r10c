import { extractMetaEntity, extractMetaUseCaseBinding } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from './catalog-surfaces';
import { MARKETPLACE_ADMIN_NAV } from './nav';
import { MARKETPLACE_ADMIN_WIZARD_SURFACES } from './wizard-surfaces';

/**
 * Every expectation below is **derived** from the two surface tables, and the
 * spec asserts the rule of each derivation rather than restating its output.
 * The tables' own order is asserted once, in `catalog-surfaces.spec.ts`; a new
 * surface is then one line there and none here (#773).
 */
const [catalog, wizards] = MARKETPLACE_ADMIN_NAV;
const catalogItems = catalog?.items ?? [];
const wizardItems = wizards?.items ?? [];

/** A domain is tenant-plane when an organization is provisioned for it. */
const TENANT_DOMAINS = new Set(['product-configuration-management']);

describe('MARKETPLACE_ADMIN_NAV', () => {
  it('offers one item per declared surface, in the tables’ order', () => {
    // Adding a surface adds its nav entry: the half that used to be forgotten
    // and left a screen unreachable.
    expect(catalogItems.map(item => item.href)).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface => surface.basePath),
    );
    expect(wizardItems.map(item => item.href)).toEqual(
      MARKETPLACE_ADMIN_WIZARD_SURFACES.map(surface => surface.basePath),
    );
  });

  it('guards a list with the read permission its own entity derives', () => {
    // A hand-typed domain string could name something the route behind it
    // does not check.
    expect(catalogItems.map(item => item.permission)).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(surface => {
        const { domain, key } = extractMetaEntity(surface.entityConstructor);
        return `${String(domain)}:${String(key)}:read`;
      }),
    );
  });

  it('guards a wizard with the write or the verb it ends in, never a read', () => {
    // Offering a flow whose whole purpose is to create to someone who may only
    // read is offering a dead end.
    expect(wizardItems.map(item => item.permission)).toEqual(
      MARKETPLACE_ADMIN_WIZARD_SURFACES.map(surface => {
        const { domain, key } = extractMetaEntity(surface.entityConstructor);
        const action =
          surface.useCase === undefined
            ? 'write'
            : extractMetaUseCaseBinding(surface.useCase).key;
        return `${String(domain)}:${String(key)}:${action}`;
      }),
    );
    expect(wizardItems.some(item => item.permission?.endsWith(':read'))).toBe(
      false,
    );
  });

  it('addresses every item’s workspace tab under its own screen type', () => {
    expect(catalogItems.map(item => item.workspace)).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(
        surface => `master:${surface.entityKey}`,
      ),
    );
    expect(wizardItems.map(item => item.workspace)).toEqual(
      MARKETPLACE_ADMIN_WIZARD_SURFACES.map(surface => `wizard:${surface.key}`),
    );
  });

  it('entitlement-gates the tenant-plane surfaces and nothing else', () => {
    // Nobody is provisioned for `catalog-reference`, so gating brands or
    // categories would hide the platform's own vocabulary from every vendor;
    // the wizards author records in the tenant-plane domain, so they are gated.
    const gated = (surface: {
      entityConstructor: Parameters<typeof extractMetaEntity>[0];
    }) =>
      TENANT_DOMAINS.has(
        String(extractMetaEntity(surface.entityConstructor).domain),
      )
        ? true
        : undefined;

    expect(catalogItems.map(item => item.entitled)).toEqual(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.map(gated),
    );
    expect(wizardItems.map(item => item.entitled)).toEqual(
      MARKETPLACE_ADMIN_WIZARD_SURFACES.map(gated),
    );
    // The rule must split the table, or it proves nothing.
    expect(new Set(catalogItems.map(item => item.entitled)).size).toBe(2);
  });

  it('types its sections as Definiciones and Asistentes', () => {
    // Contributing a `wizard` section is the whole of what makes the Asistentes
    // tier appear: the sidebar groups by `screenTypeRank` and needs no change.
    expect(MARKETPLACE_ADMIN_NAV.map(section => section.type)).toEqual([
      'master',
      'wizard',
    ]);
  });

  it("names copy in r10c's own namespace", () => {
    // An `app:` key is lint-restricted to `apps/`, so a shell binding one would
    // fail the build — and a second host would have to re-translate. Not
    // `shell:` either: since entifix 0.6.0 the framework ships none of this copy.
    const keys = MARKETPLACE_ADMIN_NAV.flatMap(section => [
      section.title,
      ...section.items.map(item => item.label),
    ]);

    expect(keys.every(key => key?.startsWith('r10c:') === true)).toBe(true);
  });
});
