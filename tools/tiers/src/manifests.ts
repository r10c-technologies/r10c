import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** The subset of a `package.json` this register reasons about. */
export interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  readonly exports?: Record<string, unknown>;
  readonly nx?: { tags?: readonly string[] };
}

export const readManifest = (dir: string): Manifest =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'),
  ) as Manifest;

export const hasManifest = (dir: string): boolean =>
  existsSync(join(REPO_ROOT, dir, 'package.json'));

/**
 * Every directory under `root` that holds a `package.json`, repo-relative.
 *
 * Walks rather than globbing a fixed depth, because the tree is not uniform —
 * `packages/entifix/style` sits one level up from `packages/entifix/ts/core`
 * and `packages/entifix/effect/service-shell`. Skips the generated directories,
 * whose own `package.json` files would otherwise register as packages.
 */
export const packageDirs = (root: string): string[] => {
  const skip = new Set(['node_modules', 'dist', 'out-tsc', 'test-output', '.next']);
  const found: string[] = [];

  const walk = (absolute: string) => {
    if (existsSync(join(absolute, 'package.json'))) {
      found.push(relative(REPO_ROOT, absolute));
      // A package never nests another. Stopping here also keeps a stray
      // manifest inside `src` from being read as a sibling package.
      return;
    }
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      walk(join(absolute, entry.name));
    }
  };

  walk(join(REPO_ROOT, root));
  return found.sort();
};

/** `['layer:entifix', 'tier:2']` → `2`, or `undefined` when unta1gged. */
export const tierTagOf = (manifest: Manifest): number | undefined => {
  const tags = (manifest.nx?.tags ?? []).filter(tag => tag.startsWith('tier:'));
  if (tags.length !== 1) return undefined;
  const value = Number(tags[0].slice('tier:'.length));
  return Number.isInteger(value) ? value : undefined;
};

export const tierTagCount = (manifest: Manifest): number =>
  (manifest.nx?.tags ?? []).filter(tag => tag.startsWith('tier:')).length;

/** Workspace dependencies only — the `@r10c/*` edges, not the npm ones. */
export const workspaceDependencies = (manifest: Manifest): string[] =>
  Object.keys(manifest.dependencies ?? {}).filter(name =>
    name.startsWith('@r10c/') || name.startsWith('@entifix/'),
  );

export const declaresOptionalPeer = (
  manifest: Manifest,
  name: string,
): boolean =>
  name in (manifest.peerDependencies ?? {}) &&
  manifest.peerDependenciesMeta?.[name]?.optional === true;
