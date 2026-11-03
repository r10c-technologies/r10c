/**
 * Every service bundle keeps a runtime package **and its subpaths** external.
 *
 * Nx's `externalDependencies` matches a request exactly, so a service listing
 * `effect` still bundled `effect/http`, `effect/sql` and `effect/http-api`, and
 * ran two copies of effect side by side. Nothing failed at build or in a spec —
 * specs run from source, never from the bundle — and the first sign was
 * config-service answering 500 to every booting service, because a Schema codec
 * built by one copy was run by the other.
 *
 * The scan pins how many configs it expects, the house rule `docs.spec.ts`
 * states, so a walk that quietly stops finding files fails rather than passes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const { externalPackages } = createRequire(import.meta.url)(
  join(REPO_ROOT, 'tools', 'webpack-externals.cjs'),
) as {
  externalPackages: (
    packages: readonly string[],
  ) => (
    data: { request: string },
    callback: (error?: null, result?: string) => void,
  ) => void;
};

/** What the matcher decides for one request: the external it names, or bundled. */
const decide = (packages: readonly string[], request: string) => {
  let decision = 'bundled';
  externalPackages(packages)({ request }, (_error, result) => {
    if (result !== undefined) decision = result;
  });
  return decision;
};

const SERVICE_CONFIGS = readdirSync(join(REPO_ROOT, 'apps'))
  .filter(app => app.endsWith('-service'))
  .map(app => join(REPO_ROOT, 'apps', app, 'webpack.config.js'));

describe('the service bundle externals', () => {
  it('keeps a package and every subpath of it external, and bundles the rest', () => {
    expect(decide(['effect'], 'effect')).toBe('commonjs effect');
    expect(decide(['effect'], 'effect/http')).toBe('commonjs effect/http');
    expect(decide(['@effect/sql-pg'], '@effect/sql-pg/PgClient')).toBe(
      'commonjs @effect/sql-pg/PgClient',
    );
  });

  /** The plants: a near-miss name and a workspace library stay in the bundle. */
  it('does not match a package that only shares a prefix', () => {
    expect(decide(['effect'], 'effect-schema')).toBe('bundled');
    expect(decide(['@effect/sql'], '@effect/sql-pg')).toBe('bundled');
    expect(decide(['effect'], '@r10c/shells-effect-service')).toBe('bundled');
  });

  it('is what every service webpack config hands to its externals', () => {
    expect(SERVICE_CONFIGS).toHaveLength(11);
    const unwired = SERVICE_CONFIGS.filter(file => {
      const text = readFileSync(file, 'utf8');
      return !(
        text.includes('externals: [externalPackages(EXTERNAL_DEPENDENCIES)]') &&
        text.includes('mergeExternals: true') &&
        text.includes('externalDependencies: EXTERNAL_DEPENDENCIES')
      );
    });
    expect(unwired).toEqual([]);
  });
});
