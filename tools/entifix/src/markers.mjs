/**
 * What a consumer's `node_modules` holds of entifix: the release its lockfile
 * pins, or copies synced from a local entifix checkout.
 *
 * entifix's `dev-sync` copies a local build over the installed release, file by
 * file, under `node_modules/.pnpm`. Every copy's manifest carries an
 * `entifixDevSync` marker and a `<release>-dev.<timestamp>` version, both written
 * by the sync. Everything in this kit — the commit guard, the status report, the
 * cache fingerprint and the restore — reads those markers through this one
 * module, so they cannot disagree about what "synced" means.
 *
 * Plain `.mjs` with no dependency and no import from the consumer, so a hook,
 * an Nx runtime input and a person can all run it without a build, and the kit
 * can move into entifix unchanged.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `{ name, version, source }` for every synced copy under a checkout's virtual
 * store, sorted and de-duplicated by name.
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

/**
 * A cache-key fragment for the task hasher: empty while the release is
 * installed, a digest of every synced `name@version` otherwise.
 *
 * Nx keys an installed package on the version its lockfile resolves, and a
 * synced copy leaves the lockfile untouched — so without this, a build against a
 * local entifix and a build against the release share one cache entry, and
 * whichever ran first is served to the other. Empty on the release keeps every
 * hash exactly what it was before this input existed; each sync writes a new dev
 * version, so each sync is a miss; and a restore brings the old hits back.
 */
export function fingerprint(packages) {
  if (packages.length === 0) return '';
  return createHash('sha256')
    .update(packages.map(pkg => `${pkg.name}@${pkg.version}`).join('\n'))
    .digest('hex')
    .slice(0, 16);
}

export function formatStatus(packages) {
  if (packages.length === 0) {
    return 'entifix: the release — every @entifix/* is what the lockfile pins.';
  }
  return [
    `entifix: ${packages.length} package(s) synced from a local checkout:`,
    ...packages.map(
      pkg => `  ${pkg.name}@${pkg.version}  (from ${pkg.source})`,
    ),
  ].join('\n');
}

export function formatSyncedFindings(packages) {
  const sources = [...new Set(packages.map(pkg => pkg.source))].join(', ');
  return [
    `node_modules carries unreleased entifix, synced from ${sources}:`,
    ...packages.map(pkg => `  ${pkg.name}@${pkg.version}`),
    '',
    'CI installs the version the lockfile pins, not this.',
    'Put the release back with `node tools/entifix/src/guard.mjs --restore`, or commit with',
    'ENTIFIX_DEV_SYNC_OK=1 if this change deliberately waits on an entifix release.',
  ].join('\n');
}
