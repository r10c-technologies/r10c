/**
 * Reading facts out of the source tree, shared by the two checks that need them:
 * `slices.spec.ts` (do the store invariants hold?) and `@r10c/docs-check` (does
 * the prose describing them still match?).
 *
 * Both read **source**, not `Symbol.metadata`. Metadata is only reachable
 * through a package's barrel, so an entity class that exists but was never
 * exported would be invisible to a metadata-based check and every invariant
 * would pass vacuously. This sees it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
export const BUSINESS_ROOT = join(REPO_ROOT, 'packages', 'business', 'ts');
export const APPS_ROOT = join(REPO_ROOT, 'apps');

/** Every `.ts` file under `dir`, recursively, skipping build output. */
export const sourceFiles = (dir: string): string[] => {
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
 * The `domain` → entity `key`s of every `@entity()` in the business layer.
 *
 * Formatting is Prettier-enforced repo-wide, so the decorator head's shape is
 * stable enough to match. A regex that silently stopped matching would make
 * every caller pass while asserting nothing, which is why both callers pin the
 * count they expect to find.
 */
export const declaredEntityDomains = (): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /@entity\(\{[^)]*?domain:\s*'([^']+)'[^)]*?key:\s*'([^']+)'/gs,
    )) {
      const [, domain, key] = match;
      found.set(domain, [...(found.get(domain) ?? []), key]);
    }
  }
  return found;
};

/**
 * The class name of every `@entity()`-decorated class, by entity `key`.
 *
 * `docs-check` needs the class name rather than the key, because that is what
 * the prose writes: BUSINESS-ARCHITECTURE names `ProductOffering`, not
 * `product-offering`.
 */
export const declaredEntityClasses = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /@entity\(\{[^)]*?key:\s*'([^']+)'[^)]*?\}\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gs,
    )) {
      found.set(match[2], match[1]);
    }
  }
  return found;
};

/** A `@useCase()` declaration, as it appears in source. */
export interface UseCaseDeclaration {
  /** The decorated class's name. */
  className: string;
  /** The entity class the verb is declared against. */
  entity: string;
  /** The verb — the third segment of the permission guarding it. */
  key: string;
  /** Every catalog key the descriptor names. */
  catalogKeys: string[];
  /** Absolute path of the file declaring it. */
  file: string;
  /** The `packages/business/ts/<name>` package it lives in. */
  packageName: string;
}

const CATALOG_KEY_FIELDS = ['labelKey', 'keywordsKey', 'messageKey'];

/**
 * Every `@useCase()` in the business layer.
 *
 * Source, not `Symbol.metadata`, for the reason at the top of this file — and
 * more sharply here than for entities: a use case registers itself onto the
 * entity when its module evaluates, so a class that is never imported leaves
 * the entity looking as if it had no actions at all. That is invisible to a
 * metadata read by construction, and it is what the barrel check in
 * `slices.spec.ts` exists to catch.
 *
 * The lazy `[\s\S]*?\}\)` hop tolerates the nested `confirm: { … }` object: the
 * first `})` in a declaration is always the decorator's own close, because a
 * descriptor holds no parentheses.
 */
export const declaredUseCases = (): UseCaseDeclaration[] => {
  const found: UseCaseDeclaration[] = [];
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /@useCase\(\{([\s\S]*?)\}\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
    )) {
      const [, body, className] = match;
      const entity = /entity:\s*(\w+)/.exec(body)?.[1];
      const key = /\bkey:\s*'([^']+)'/.exec(body)?.[1];
      if (entity === undefined || key === undefined) continue;
      const catalogKeys = CATALOG_KEY_FIELDS.flatMap(field =>
        [...body.matchAll(new RegExp(`\\b${field}:\\s*'([^']+)'`, 'g'))].map(
          hit => hit[1],
        ),
      );
      found.push({
        className,
        entity,
        key,
        catalogKeys,
        file,
        packageName: relative(BUSINESS_ROOT, file).split(sep)[0],
      });
    }
  }
  return found;
};

/**
 * Does a package's public barrel transitively re-export `file`?
 *
 * Walks `export * from './x'` from `src/index.ts` inward, which is exactly the
 * path an importer takes. A `@useCase()` class the barrel cannot reach is one
 * no composition root can load, so its entity would serve an empty action list.
 */
export const barrelReaches = (packageName: string, file: string): boolean => {
  const root = join(BUSINESS_ROOT, packageName, 'src');
  const target = relative(root, file).split(sep).join('/');

  const walk = (dir: string, seen: Set<string>): boolean => {
    const index = join(dir, 'index.ts');
    if (seen.has(index)) return false;
    seen.add(index);
    let text: string;
    try {
      text = readFileSync(index, 'utf8');
    } catch {
      return false;
    }
    for (const match of text.matchAll(/export \* from '\.\/([^']+)'/g)) {
      const next = join(dir, match[1]);
      const asFile = relative(root, `${next}.ts`).split(sep).join('/');
      if (asFile === target) return true;
      if (walk(next, seen)) return true;
    }
    return false;
  };

  return walk(root, new Set());
};
