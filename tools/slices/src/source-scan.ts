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
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.url` rather than `import.meta.dirname`, and never inside a
// `new URL(…)`: the docs site bundles this register with webpack, which
// inlines the URL, leaves `dirname` undefined and treats a `new URL` as an
// asset to emit.
export const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
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

/**
 * The `<domain>:<key>` permission prefix of every `@entity()` class, by class
 * name — what a use case's `entity: ProductBrand` resolves to when a check has
 * to build the permission that guards its verb.
 */
export const declaredEntityResources = (): Map<string, string> => {
  const found = new Map<string, string>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(
      /@entity\(\{[^)]*?domain:\s*'([^']+)'[^)]*?key:\s*'([^']+)'[^)]*?\}\)\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gs,
    )) {
      found.set(match[3], `${match[1]}:${match[2]}`);
    }
  }
  return found;
};

/**
 * The members each `@entity()` declares `filterable: true`, by its
 * `<domain>:<key>` — the server's allowlist for a query, and what a register
 * entry that filters a read must name (ADR 0080 §2).
 *
 * A member belongs to the last `@entity()` above it in its file. The accessor's
 * options are matched up to one level of nested braces, which is as deep as
 * any `@accessor({ … })` in the business layer goes.
 */
export const declaredFilterableMembers = (): Map<string, Set<string>> => {
  const found = new Map<string, Set<string>>();
  for (const file of sourceFiles(BUSINESS_ROOT)) {
    const text = readFileSync(file, 'utf8');
    const entities = [
      ...text.matchAll(
        /@entity\(\{[^)]*?domain:\s*'([^']+)'[^)]*?key:\s*'([^']+)'/gs,
      ),
    ].map(match => ({ at: match.index, resource: `${match[1]}:${match[2]}` }));
    if (entities.length === 0) continue;
    for (const match of text.matchAll(
      /@accessor\(\{((?:[^{}]|\{[^{}]*\})*)\}\)\s*get\s+(\w+)\(/gs,
    )) {
      if (!/filterable:\s*true/.test(match[1])) continue;
      const owner = entities.filter(entity => entity.at < match.index).at(-1);
      if (owner === undefined) continue;
      const members = found.get(owner.resource) ?? new Set<string>();
      members.add(match[2]);
      found.set(owner.resource, members);
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
  /**
   * How a destructive verb is taken back (entifix ADR 0026): `undo` acts at
   * once and offers the `inverse` verb, `confirm` asks first. Absent on a verb
   * that destroys nothing.
   */
  reversible?: 'undo' | 'confirm';
  /** The verb an `undo` runs over the same selection. */
  inverse?: string;
  /** The flow recipe the verb starts (`recipe: 'cancellation'`), when it starts one. */
  recipe?: string;
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
      const reversible = /\breversible:\s*'(undo|confirm)'/.exec(body)?.[1] as
        'undo' | 'confirm' | undefined;
      const inverse = /\binverse:\s*'([^']+)'/.exec(body)?.[1];
      const recipe = /\brecipe:\s*'([^']+)'/.exec(body)?.[1];
      found.push({
        className,
        entity,
        key,
        catalogKeys,
        ...(reversible === undefined ? {} : { reversible }),
        ...(inverse === undefined ? {} : { inverse }),
        ...(recipe === undefined ? {} : { recipe }),
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
