/**
 * The third gate, for the keys an entity names about itself.
 *
 * An `@accessor()` names a `labelKey` — its column header and its field label —
 * and an enum names an `enumLabelKey` whose children label each value. Both are
 * **runtime** keys: the table and the form resolve them through
 * `useTranslateKey`, which casts the key type away, so a missing one compiles
 * clean and the parity check passes when both locales lack it. The reader then
 * sees `product-order.fields.totalAmount` as a column header, which is how
 * twenty-four of them reached the back office after the fiscal facts (#732)
 * landed without catalog entries.
 *
 * A source scan rather than a walk of the metadata: entities live in a dozen
 * packages and nothing registers them all, while every key is a literal in the
 * decorator that declares it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { R10C_RESOURCES as resources } from '@r10c/i18n-catalog';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const BUSINESS_ROOT = join(REPO_ROOT, 'packages/business/ts');

/** `es` is the reference locale; `en` is typed from it. */
const catalog = resources.es as unknown as Record<string, unknown>;

/** Walk `<namespace>:<dotted.path>` to whatever the catalog holds there. */
const lookup = (key: string): unknown => {
  const [namespace, path] = key.split(':');
  if (path === undefined) return undefined;
  let node: unknown = catalog[namespace];
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
};

/** A label is a sentence. */
export const labelResolves = (key: string): boolean => {
  const node = lookup(key);
  return typeof node === 'string' && node.length > 0;
};

/** An enum's label key is a group holding one sentence per value. */
export const enumLabelResolves = (key: string): boolean => {
  const node = lookup(key);
  if (typeof node !== 'object' || node === null) return false;
  const values = Object.values(node);
  return (
    values.length > 0 &&
    values.every(value => typeof value === 'string' && value.length > 0)
  );
};

interface DeclaredKey {
  readonly field: 'labelKey' | 'enumLabelKey';
  readonly key: string;
  readonly file: string;
}

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return ['node_modules', 'dist', 'test-output'].includes(entry.name)
        ? []
        : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')
      ? [path]
      : [];
  });

/** Every namespaced key literal named by `labelKey:` or `enumLabelKey:`. */
export const declaredKeys = (text: string, file: string): DeclaredKey[] =>
  [...text.matchAll(/\b(labelKey|enumLabelKey):\s*'([\w-]+:[^']+)'/g)].map(
    ([, field, key]) => ({
      field: field as DeclaredKey['field'],
      key,
      file,
    }),
  );

const declared = readdirSync(BUSINESS_ROOT, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap(entry => sourceFiles(join(BUSINESS_ROOT, entry.name, 'src')))
  .flatMap(file =>
    declaredKeys(readFileSync(file, 'utf8'), relative(REPO_ROOT, file)),
  );

describe('The entity key resolvers', () => {
  it('read a label as a sentence and an enum label as a group of them', () => {
    expect(labelResolves('entity:product-order.fields.status')).toBe(true);
    expect(enumLabelResolves('entity:product-order.values.status')).toBe(true);
  });

  it('reject a group where a sentence belongs, and the reverse', () => {
    expect(labelResolves('entity:product-order.values.status')).toBe(false);
    expect(enumLabelResolves('entity:product-order.fields.status')).toBe(false);
  });

  it('catch a key no catalog defines (planted)', () => {
    const [planted] = declaredKeys(
      "@accessor({ labelKey: 'entity:product-order.fields.nope' })",
      'planted.ts',
    );
    expect(labelResolves(planted.key)).toBe(false);
  });
});

describe('Catalog keys an entity names about itself', () => {
  it('finds the declarations it is meant to check', () => {
    // A scan that silently stops matching would pass while checking nothing.
    expect(
      declared.filter(entry => entry.field === 'labelKey').length,
    ).toBeGreaterThan(100);
    expect(
      declared.filter(entry => entry.field === 'enumLabelKey').length,
    ).toBeGreaterThan(10);
  });

  it('all resolve in the reference catalog', () => {
    const missing = declared.filter(({ field, key }) =>
      field === 'labelKey' ? !labelResolves(key) : !enumLabelResolves(key),
    );
    expect(
      missing.map(({ field, key, file }) => `${file}: ${field} '${key}'`),
      'These keys are named by an entity and missing from the es catalog. ' +
        'The render path casts the key type away and a key missing from both ' +
        'locales is symmetric, so nothing else fails: the reader sees the raw key.',
    ).toEqual([]);
  });
});
