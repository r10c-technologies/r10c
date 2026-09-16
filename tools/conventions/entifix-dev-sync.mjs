#!/usr/bin/env node
/**
 * Refuses a commit made while `node_modules` carries an unreleased entifix.
 *
 * entifix's `dev-sync` copies a local build over the release this repository
 * installs, so a change can be tried here the moment it is saved in entifix.
 * That copy lives only in `node_modules`: CI installs the version the catalog in
 * `pnpm-workspace.yaml` pins. A commit that works locally because of synced code
 * is therefore a commit that fails in CI, or worse passes there against a
 * release that does not have the behaviour it was written for.
 *
 * Every synced copy carries an `entifixDevSync` marker in its manifest, written
 * by the sync and removed by `pnpm install --force`. This reads the markers.
 *
 * `ENTIFIX_DEV_SYNC_OK=1` lets a commit through deliberately — a branch that is
 * waiting on an entifix release it already knows it needs. The escape is an
 * environment variable rather than `--no-verify` so the rest of the hook still
 * runs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `{ name, version, entifixDevSync }` for every synced copy under a checkout's
 * virtual store, sorted and de-duplicated by name.
 *
 * pnpm keeps one directory per resolved peer set, so one package can have
 * several copies; the report names the package once.
 */
export function syncedEntifixPackages(root) {
  const store = join(root, 'node_modules', '.pnpm');
  if (!existsSync(store)) return [];
  const found = new Map();
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith('@entifix+')) continue;
    const scope = join(store, entry, 'node_modules', '@entifix');
    if (!existsSync(scope)) continue;
    for (const name of readdirSync(scope)) {
      const manifestPath = join(scope, name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      if (manifest.entifixDevSync && !found.has(manifest.name)) {
        found.set(manifest.name, {
          name: manifest.name,
          version: manifest.version,
          source: manifest.entifixDevSync.source,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function formatSyncedFindings(packages) {
  const sources = [...new Set(packages.map(pkg => pkg.source))].join(', ');
  return [
    `node_modules carries unreleased entifix, synced from ${sources}:`,
    ...packages.map(pkg => `  ${pkg.name}@${pkg.version}`),
    '',
    'CI installs the version the catalog in pnpm-workspace.yaml pins, not this.',
    'Put the release back with `pnpm install --force`, or commit with',
    'ENTIFIX_DEV_SYNC_OK=1 if this change deliberately waits on an entifix release.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const synced = syncedEntifixPackages(process.cwd());
  if (synced.length > 0 && process.env.ENTIFIX_DEV_SYNC_OK !== '1') {
    console.error(formatSyncedFindings(synced));
    process.exit(1);
  }
}
