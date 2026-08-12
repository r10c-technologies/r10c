import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SLICES } from './registry.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const BUSINESS_ROOT = join(REPO_ROOT, 'packages', 'business', 'ts');
const APPS_ROOT = join(REPO_ROOT, 'apps');

/** Every `.ts` file under `dir`, recursively, skipping build output. */
const sourceFiles = (dir: string): string[] => {
  const skip = new Set(['node_modules', 'dist', 'out-tsc', 'test-output']);
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      if (skip.has(entry.name)) return [];
      const full = join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
        ? [full]
        : [];
    });
  return walk(dir);
};

/**
 * The `domain` of every `@entity()` in the business layer, read from source
 * rather than from `Symbol.metadata`.
 *
 * Source is the stronger signal here: metadata is only reachable through a
 * package's barrel, so an entity class that exists but was never exported would
 * be invisible to a metadata-based check and the invariant would pass
 * vacuously. This sees it.
 */
const declaredEntityDomains = (): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    // Matches the `@entity({ … domain: 'x' … key: 'y' … })` head. Formatting is
    // Prettier-enforced repo-wide, so the shape is stable.
    for (const match of text.matchAll(
      /@entity\(\{[^)]*?domain:\s*'([^']+)'[^)]*?key:\s*'([^']+)'/gs,
    )) {
      const [, domain, key] = match;
      found.set(domain, [...(found.get(domain) ?? []), key]);
    }
  }
  return found;
};

const allStores = SLICES.flatMap(slice =>
  slice.stores.map(store => ({ slice, store })),
);

describe('ADR 0020 — the store register is complete', () => {
  // A regex that silently stops matching would make every test below pass while
  // asserting nothing. Pin the count so that failure is loud.
  it('finds the entity declarations it is meant to check', () => {
    const domains = declaredEntityDomains();
    const entityCount = [...domains.values()].flat().length;

    expect(domains.size).toBeGreaterThanOrEqual(5);
    expect(entityCount).toBeGreaterThanOrEqual(12);
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
