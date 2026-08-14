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
import { join } from 'node:path';

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
