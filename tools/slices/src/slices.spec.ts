import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SLICES } from './registry.js';
import {
  APPS_ROOT,
  barrelReaches,
  BUSINESS_ROOT,
  declaredEntityClasses,
  declaredEntityDomains,
  declaredUseCases,
  sourceFiles,
} from './source-scan.js';

const allStores = SLICES.flatMap(slice =>
  slice.stores.map(store => ({ slice, store })),
);

describe('ADR 0020 — the store register is complete', () => {
  // A regex that silently stops matching would make every test below pass while
  // asserting nothing. Pin the count so that failure is loud.
  it('finds the entity declarations it is meant to check', () => {
    const domains = declaredEntityDomains();
    const entityCount = [...domains.values()].flat().length;

    expect(domains.size).toBeGreaterThanOrEqual(11);
    expect(entityCount).toBeGreaterThanOrEqual(23);
  });

  it('declares a multi-domain store as a binding, with its cost', () => {
    for (const { store } of allStores) {
      if (store.hosts.length > 1) {
        expect(
          store.bindingReason,
          `store '${store.name}' hosts ${store.hosts.length} domains and must ` +
            'record why they are permanently co-deployed',
        ).toBeTruthy();
      }
    }
  });
});

describe("Invariant 1 — a domain's entities live in exactly one Store", () => {
  it('hosts every entity-owning domain in exactly one store', () => {
    const hostedIn = new Map<string, string[]>();
    for (const { store } of allStores) {
      for (const domain of store.hosts) {
        hostedIn.set(domain, [...(hostedIn.get(domain) ?? []), store.name]);
      }
    }

    for (const [domain, keys] of declaredEntityDomains()) {
      const stores = hostedIn.get(domain) ?? [];
      expect(
        stores,
        `domain '${domain}' owns ${keys.length} entities (${keys.join(', ')}) ` +
          `but is hosted by ${stores.length} stores: [${stores.join(', ')}]`,
      ).toHaveLength(1);
    }
  });

  it('hosts no domain that owns no entities', () => {
    const domains = declaredEntityDomains();

    for (const { store } of allStores) {
      for (const domain of store.hosts) {
        expect(
          domains.has(domain),
          `store '${store.name}' claims to host '${domain}', which declares no ` +
            '@entity() anywhere in packages/business',
        ).toBe(true);
      }
    }
  });
});

describe('Invariant 2 — a Store has exactly one writing Slice', () => {
  it('declares each store name under exactly one slice', () => {
    const owners = new Map<string, string[]>();
    for (const { slice, store } of allStores) {
      owners.set(store.name, [...(owners.get(store.name) ?? []), slice.name]);
    }

    for (const [store, slices] of owners) {
      expect(
        slices,
        `store '${store}' is declared by slices [${slices.join(', ')}]`,
      ).toHaveLength(1);
    }
  });

  it('gives a projection a store it is a projection of', () => {
    const names = new Set(allStores.map(({ store }) => store.name));

    for (const { store } of allStores) {
      if (store.truth === 'system-of-record') continue;
      const source = store.truth.slice('projection-of:'.length);
      expect(
        names.has(source),
        `store '${store.name}' projects '${source}', which is not declared`,
      ).toBe(true);
    }
  });
});

describe('Invariant 3 — a Slice writes only the Stores it owns', () => {
  /** Apps that bind a repository to a datastore, i.e. the `host:effect` set. */
  const datastoreApps = () =>
    readdirSync(APPS_ROOT, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.endsWith('-e2e'))
      .filter(entry => {
        const src = join(APPS_ROOT, entry.name, 'src');
        try {
          if (!statSync(src).isDirectory()) return false;
        } catch {
          return false;
        }
        return sourceFiles(src).some(file =>
          /MongoClientLayer|MongoDatabaseLayer|makeSqlRepository|PgClient/.test(
            readFileSync(file, 'utf8'),
          ),
        );
      })
      .map(entry => entry.name);

  it('runs every datastore-bound app as a declared slice deployment', () => {
    const declared = new Set(SLICES.flatMap(slice => slice.deployments));

    for (const app of datastoreApps()) {
      expect(
        declared.has(app),
        `app '${app}' opens a datastore connection but no slice declares it as ` +
          'a deployment — it would be a writer nothing owns',
      ).toBe(true);
    }
  });

  it('declares no deployment that does not exist', () => {
    const apps = new Set(
      readdirSync(APPS_ROOT, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
    );

    for (const slice of SLICES) {
      for (const deployment of slice.deployments) {
        expect(
          apps.has(deployment),
          `slice '${slice.name}' declares deployment '${deployment}', which is ` +
            'not an app in this repository',
        ).toBe(true);
      }
    }
  });

  // The `host:next` / `runtime:datastore` boundary rule already fails the build
  // on a Next app importing a datastore client. This is the ownership half of
  // the same statement: a Next app owns no store, so it is in no slice.
  it('places no Next app in a slice', () => {
    const declared = new Set(SLICES.flatMap(slice => slice.deployments));

    for (const app of declared) {
      expect(
        app.endsWith('-app'),
        `'${app}' is a Next host and owns no store, so it belongs to no slice`,
      ).toBe(false);
    }
  });
});

describe('Co-deployment is recorded, and is symmetric', () => {
  it('records co-deployment on both slices sharing a process', () => {
    const byDeployment = new Map<string, string[]>();
    for (const slice of SLICES) {
      for (const deployment of slice.deployments) {
        byDeployment.set(deployment, [
          ...(byDeployment.get(deployment) ?? []),
          slice.name,
        ]);
      }
    }

    for (const [deployment, slices] of byDeployment) {
      if (slices.length < 2) continue;
      for (const name of slices) {
        const slice = SLICES.find(candidate => candidate.name === name);
        const others = slices.filter(other => other !== name);
        expect(
          [...(slice?.coDeployedWith ?? [])].sort(),
          `slices [${slices.join(', ')}] share deployment '${deployment}', so ` +
            `'${name}' must record the others in coDeployedWith`,
        ).toEqual(others.sort());
      }
    }
  });

  it('names a real slice in every coDeployedWith', () => {
    const names = new Set(SLICES.map(slice => slice.name));

    for (const slice of SLICES) {
      for (const other of slice.coDeployedWith) {
        expect(
          names.has(other),
          `slice '${slice.name}' is co-deployed with '${other}', which is not a ` +
            'declared slice',
        ).toBe(true);
      }
    }
  });
});

describe('A planned slice owns stores but runs nothing', () => {
  // Ownership can be recorded before a process exists — the invariants above
  // apply either way, which is the point. What a planned slice must not do is
  // claim a deployment: a database handle opened for a store nothing writes is
  // a persistence boundary with no contents, which is exactly what ADR 0020
  // struck `marketplace_admin` from the register for.
  it('gives every active slice at least one deployment', () => {
    for (const slice of SLICES) {
      if (slice.status !== 'active') continue;
      expect(
        slice.deployments.length,
        `slice '${slice.name}' is active but declares no deployment — either ` +
          'it runs somewhere and should say where, or it is planned',
      ).toBeGreaterThan(0);
    }
  });

  it('gives every planned slice none', () => {
    for (const slice of SLICES) {
      if (slice.status !== 'planned') continue;
      expect(
        slice.deployments,
        `slice '${slice.name}' is planned but claims deployment(s) ` +
          `[${slice.deployments.join(', ')}] — promote it to active instead`,
      ).toEqual([]);
    }
  });

  it('co-deploys nothing that does not run', () => {
    for (const slice of SLICES) {
      if (slice.status === 'active') continue;
      expect(
        slice.coDeployedWith,
        `slice '${slice.name}' is planned, so it shares no process with ` +
          `[${slice.coDeployedWith.join(', ')}]`,
      ).toEqual([]);
    }
  });
});

describe('Every business domain package is claimed by a slice', () => {
  /**
   * The domain names declared as `*_DOMAIN` constants under
   * `packages/business/ts`.
   *
   * This complements Invariant 1 rather than repeating it. That one starts from
   * `@entity()` declarations, so it cannot see a domain package that owns no
   * entities *yet* — which is exactly the state every skeleton package was in,
   * and exactly when a boundary gets decided by whoever writes the first entity.
   * This starts from the package instead.
   *
   * Not every domain package has a `domain.ts` (`authn`, `configuration` and
   * `product-configuration-management` predate the convention), so this checks
   * the ones that do rather than requiring the file.
   */
  const declaredDomainConstants = (): Map<string, string> => {
    const found = new Map<string, string>();
    for (const entry of readdirSync(BUSINESS_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = join(BUSINESS_ROOT, entry.name, 'src', 'domain.ts');
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const match = /export const [A-Z_]+ = '([^']+)'/.exec(text);
      if (match) found.set(match[1], entry.name);
    }
    return found;
  };

  it('finds the domain constants it is meant to check', () => {
    // Same guard as the entity scan: a regex that silently stops matching
    // would make the assertion below pass while checking nothing.
    expect(declaredDomainConstants().size).toBeGreaterThanOrEqual(6);
  });

  it('claims every declared domain in exactly one slice', () => {
    const claimedBy = new Map<string, string[]>();
    for (const slice of SLICES) {
      for (const domain of slice.domains) {
        claimedBy.set(domain, [...(claimedBy.get(domain) ?? []), slice.name]);
      }
    }

    for (const [domain, packageName] of declaredDomainConstants()) {
      const slices = claimedBy.get(domain) ?? [];
      expect(
        slices,
        `packages/business/ts/${packageName} declares domain '${domain}', ` +
          `which ${slices.length} slices claim: [${slices.join(', ')}]. A ` +
          'domain package with no slice is a boundary nobody has decided.',
      ).toHaveLength(1);
    }
  });

  it('claims no domain that no package declares', () => {
    const declared = new Set(declaredDomainConstants().keys());
    // Domains whose package predates the `domain.ts` convention. Invariant 1
    // still covers them, because each owns entities.
    const withoutConstant = new Set([
      'authn',
      'config',
      'product-configuration-management',
    ]);

    for (const slice of SLICES) {
      for (const domain of slice.domains) {
        if (withoutConstant.has(domain)) continue;
        expect(
          declared.has(domain),
          `slice '${slice.name}' claims domain '${domain}', which no package ` +
            'under packages/business/ts declares',
        ).toBe(true);
      }
    }
  });
});

/**
 * ADR 0026 opened the action segment of a permission to per-entity verbs. That
 * removed the only thing narrowing it, so nothing but this file now connects a
 * declared verb to the grant that allows it and the class that implements it.
 *
 * Everything here reads source rather than metadata, and for a sharper reason
 * than the entity scans above: a `@useCase()` registers itself onto its entity
 * when its module evaluates, so a class nothing imports leaves the entity
 * looking as though it had no actions. A metadata-based check cannot see that
 * at all.
 */
describe('ADR 0026 — declared use cases, their grants and their implementations', () => {
  /** Verb segments that are the CRUD triple or a wildcard, not use cases. */
  const NOT_A_VERB = new Set(['read', 'write', 'delete', '*']);

  /**
   * The action segment of every permission in the grant table.
   *
   * Read from source because the grants are the one place a verb is written as
   * a literal: `business:policy` may depend only on `layer:entifix`/`layer:utils`,
   * so `role-permissions.ts` cannot import the constant a use case derives.
   */
  const grantedActions = (): Map<string, string[]> => {
    const file = join(
      BUSINESS_ROOT,
      'authz',
      'src',
      'values',
      'role-permissions.ts',
    );
    const text = readFileSync(file, 'utf8');
    const found = new Map<string, string[]>();
    for (const match of text.matchAll(
      /[`']\$?\{?[A-Za-z_]*\}?[^`':]*:[^`':]+:([A-Za-z*-]+)[`']/g,
    )) {
      const action = match[1];
      found.set(action, [...(found.get(action) ?? []), match[0]]);
    }
    return found;
  };

  it('finds the declarations it is meant to check', () => {
    // Same guard as every other scan here: a regex that silently stops matching
    // would make the assertions below pass while checking nothing.
    expect(declaredUseCases().length).toBeGreaterThanOrEqual(2);
    expect(grantedActions().size).toBeGreaterThanOrEqual(4);
  });

  it('declares every use case against an entity that exists', () => {
    const classes = declaredEntityClasses();
    for (const useCase of declaredUseCases()) {
      expect(
        classes.has(useCase.entity),
        `${useCase.className} declares '${useCase.key}' against ` +
          `${useCase.entity}, which is not an @entity() class under ` +
          'packages/business/ts',
      ).toBe(true);
    }
  });

  it('gives each entity at most one implementation per verb', () => {
    const byVerb = new Map<string, string[]>();
    for (const useCase of declaredUseCases()) {
      const id = `${useCase.entity}:${useCase.key}`;
      byVerb.set(id, [...(byVerb.get(id) ?? []), useCase.className]);
    }

    for (const [id, classNames] of byVerb) {
      expect(
        classNames,
        `${classNames.length} use cases implement '${id}': ` +
          `[${classNames.join(', ')}]. A verb is the third segment of one ` +
          'permission, so two implementations are one permission with two ' +
          'meanings.',
      ).toHaveLength(1);
    }
  });

  it('grants every declared verb to somebody', () => {
    const granted = grantedActions();
    for (const useCase of declaredUseCases()) {
      expect(
        granted.has(useCase.key),
        `${useCase.className} declares the verb '${useCase.key}', which no ` +
          'ROLE_PERMISSIONS grant names. Nobody but super-admin can reach it, ' +
          'and super-admin only because *:*:* covers everything.',
      ).toBe(true);
    }
  });

  it('grants no verb that nothing declares', () => {
    const declared = new Set(declaredUseCases().map(useCase => useCase.key));
    for (const [action, grants] of grantedActions()) {
      if (NOT_A_VERB.has(action)) continue;
      expect(
        declared.has(action),
        `ROLE_PERMISSIONS grants '${action}' (${grants.join(', ')}), which no ` +
          '@useCase() declares. A grant for a verb that does not exist is ' +
          'either a typo or a permission left behind by a rename.',
      ).toBe(true);
    }
  });

  it('exports every use case from its package barrel', () => {
    for (const useCase of declaredUseCases()) {
      expect(
        barrelReaches(useCase.packageName, useCase.file),
        `${useCase.className} is not reachable from ` +
          `packages/business/ts/${useCase.packageName}/src/index.ts. A ` +
          '@useCase() registers itself onto its entity when its module ' +
          'evaluates, so a class no importer can reach makes the entity serve ' +
          'an empty action list — a 200 that reads as "no actions here".',
      ).toBe(true);
    }
  });
});
