/**
 * Which running services a sync has to restart.
 *
 * A Next dev server serves a synced entifix change by itself. A service started
 * by `@nx/js:node` does not: it restarts on the Nx daemon's file events, and the
 * daemon ignores `node_modules`, so the process keeps the code it booted with.
 * The restart path itself works — touching a file the daemon does watch fires it,
 * and a touch changes no content, so `git status` stays clean (measured on
 * config-service by touching its `package.json`).
 *
 * So after a sync the kit touches the manifest of every service that runs a
 * changed package. "Runs" follows entifix's own dependencies as well: a change to
 * `@entifix/core` restarts a service that names only `@entifix/service-shell`.
 *
 * Plain `.mjs` with no dependency and no import from the consumer, like the rest
 * of the kit. What it reads of the consumer is its tracked `package.json` files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

import { syncedEntifixPackages } from './markers.mjs';

/** The executor whose restart is driven by the daemon's file events. */
export const RESTARTING_EXECUTOR = '@nx/js:node';

/** `name → version` for every synced copy; empty on the release. */
export function syncedVersions(root) {
  return new Map(
    syncedEntifixPackages(root).map(pkg => [pkg.name, pkg.version]),
  );
}

/**
 * Package names whose synced version differs between two readings — changed,
 * newly synced, or put back to the release.
 */
export function changedPackages(before, after) {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter(name => before.get(name) !== after.get(name)).sort();
}

const manifestDependencies = manifest =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });

/**
 * `name → Set<@entifix/* it depends on>` for every entifix package installed
 * under the virtual store, synced or not.
 *
 * Only an entry's own package is read: `@entifix+amqp@…` also links the
 * packages amqp depends on beside it, and those are read from their own entries.
 */
export function entifixDependencies(root) {
  const store = join(root, 'node_modules', '.pnpm');
  const graph = new Map();
  if (!existsSync(store)) return graph;
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith('@entifix+')) continue;
    const own = entry.slice('@entifix+'.length).split('@')[0];
    const manifestPath = join(
      store,
      entry,
      'node_modules',
      '@entifix',
      own,
      'package.json',
    );
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const deps = graph.get(manifest.name) ?? new Set();
    for (const dep of manifestDependencies(manifest)) {
      if (dep.startsWith('@entifix/')) deps.add(dep);
    }
    graph.set(manifest.name, deps);
  }
  return graph;
}

/** The changed packages plus every entifix package that reaches one of them. */
export function affectedPackages(changed, dependencies) {
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, deps] of dependencies) {
      if (affected.has(name)) continue;
      if ([...deps].some(dep => affected.has(dep))) {
        affected.add(name);
        grew = true;
      }
    }
  }
  return affected;
}

/** Every tracked `package.json` in the consumer, parsed, with its path. */
export function workspaceManifests(root) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--', 'package.json', ':(glob)**/package.json'],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter(path => existsSync(join(root, path)))
    .map(path => ({
      path,
      manifest: JSON.parse(readFileSync(join(root, path), 'utf8')),
    }));
}

/**
 * The manifests of the projects whose `dev` restarts on file events and whose
 * own dependencies name an affected package, sorted by project name.
 */
export function servicesToRestart(manifests, affected) {
  return manifests
    .filter(
      ({ manifest }) =>
        manifest.nx?.targets?.dev?.executor === RESTARTING_EXECUTOR &&
        manifestDependencies(manifest).some(dep => affected.has(dep)),
    )
    .map(({ path, manifest }) => ({ name: manifest.name, path }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fires each service's restart by bumping its manifest's mtime. */
export function touch(root, services, now = new Date()) {
  for (const service of services) {
    utimesSync(join(root, service.path), now, now);
  }
}

export function formatRestart(changed, services, event = 'synced') {
  const what = changed.join(', ');
  if (services.length === 0) {
    return `entifix:reload: ${what} ${event} — no running service depends on it.`;
  }
  return `entifix:reload: ${what} ${event} — restarting ${services
    .map(service => service.name)
    .join(', ')}.`;
}
