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
 * by the sync. This reads the markers, and with `--restore` puts the release
 * back.
 *
 * `ENTIFIX_DEV_SYNC_OK=1` lets a commit through deliberately — a branch that is
 * waiting on an entifix release it already knows it needs. The escape is an
 * environment variable rather than `--no-verify` so the rest of the hook still
 * runs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

/**
 * The virtual-store entries whose own package is a synced copy.
 *
 * An entry such as `@entifix+amqp@0.1.1_…` also links the entifix packages amqp
 * depends on beside it, so only the entry's own package decides — otherwise
 * one synced `core` would mark every entry that depends on it.
 */
export function syncedEntifixEntries(root) {
  const store = join(root, 'node_modules', '.pnpm');
  if (!existsSync(store)) return [];
  return readdirSync(store)
    .filter(entry => entry.startsWith('@entifix+'))
    .filter(entry => {
      const name = entry.slice('@entifix+'.length).split('@')[0];
      const manifest = join(
        store,
        entry,
        'node_modules',
        '@entifix',
        name,
        'package.json',
      );
      return (
        existsSync(manifest) &&
        'entifixDevSync' in JSON.parse(readFileSync(manifest, 'utf8'))
      );
    })
    .map(entry => join(store, entry))
    .sort();
}

/**
 * Deletes every synced entry and re-links the release in their place.
 *
 * ⚠️ Not `pnpm install --force`. With manifests and lockfile unchanged, pnpm 11's
 * optimistic repeat install answers "Already up to date" and leaves every synced
 * copy where it is. Deleting the entries and installing non-optimistically takes
 * about a second and a half; a forced refetch of the whole tree took four
 * minutes.
 */
export function restoreRelease(root, install) {
  const entries = syncedEntifixEntries(root);
  for (const entry of entries) rmSync(entry, { recursive: true, force: true });
  if (entries.length > 0) install(root);
  return entries.length;
}

export function formatSyncedFindings(packages) {
  const sources = [...new Set(packages.map(pkg => pkg.source))].join(', ');
  return [
    `node_modules carries unreleased entifix, synced from ${sources}:`,
    ...packages.map(pkg => `  ${pkg.name}@${pkg.version}`),
    '',
    'CI installs the version the catalog in pnpm-workspace.yaml pins, not this.',
    'Put the release back with `node tools/conventions/entifix-dev-sync.mjs --restore`, or commit with',
    'ENTIFIX_DEV_SYNC_OK=1 if this change deliberately waits on an entifix release.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--restore')) {
    const restored = restoreRelease(process.cwd(), root =>
      execFileSync(
        'pnpm',
        ['install', '--config.optimistic-repeat-install=false'],
        {
          cwd: root,
          stdio: 'inherit',
        },
      ),
    );
    console.log(`Restored ${restored} synced entifix entries to the release.`);
    process.exit(0);
  }
  const synced = syncedEntifixPackages(process.cwd());
  if (synced.length > 0 && process.env.ENTIFIX_DEV_SYNC_OK !== '1') {
    console.error(formatSyncedFindings(synced));
    process.exit(1);
  }
}
