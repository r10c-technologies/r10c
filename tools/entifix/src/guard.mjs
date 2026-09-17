#!/usr/bin/env node
/**
 * Refuses a commit made while `node_modules` carries an unreleased entifix, and
 * with `--restore` puts the release back.
 *
 *   node tools/entifix/src/guard.mjs            (from .husky/pre-commit)
 *   node tools/entifix/src/guard.mjs --restore
 *
 * A synced copy lives only in `node_modules`, and CI installs the version the
 * lockfile pins. A commit that works locally because of synced code is therefore
 * a commit that fails in CI, or worse passes there against a release that does
 * not have the behaviour it was written for.
 *
 * `ENTIFIX_DEV_SYNC_OK=1` lets a commit through deliberately — a branch that is
 * waiting on an entifix release it already knows it needs. The escape is an
 * environment variable rather than `--no-verify` so the rest of the hook still
 * runs.
 */
import { execFileSync } from 'node:child_process';

import {
  affectedPackages,
  entifixDependencies,
  formatRestart,
  servicesToRestart,
  touch,
  workspaceManifests,
} from './consumers.mjs';
import {
  formatSyncedFindings,
  restoreRelease,
  syncedEntifixPackages,
} from './markers.mjs';

const root = process.cwd();

if (process.argv.includes('--restore')) {
  // Read before the restore deletes them: a running service still holds the
  // synced code, and `entifix:local`'s reload loop has stopped by now.
  const wasSynced = syncedEntifixPackages(root).map(pkg => pkg.name);
  const dependencies = entifixDependencies(root);
  const restored = restoreRelease(root, dir =>
    execFileSync(
      'pnpm',
      [
        'install',
        '--config.optimistic-repeat-install=false',
        // Drop orphaned store entries too, or a previous release's copies
        // linger for a week and the next sync writes into them (local.sh).
        '--config.modules-cache-max-age=0',
      ],
      {
        cwd: dir,
        stdio: 'inherit',
      },
    ),
  );
  console.log(`Restored ${restored} synced entifix entries to the release.`);
  if (wasSynced.length > 0) {
    const services = servicesToRestart(
      workspaceManifests(root),
      affectedPackages(wasSynced, dependencies),
    );
    touch(root, services);
    console.log(formatRestart(wasSynced, services, 'put back'));
  }
} else {
  const synced = syncedEntifixPackages(root);
  if (synced.length > 0 && process.env.ENTIFIX_DEV_SYNC_OK !== '1') {
    console.error(formatSyncedFindings(synced));
    process.exitCode = 1;
  }
}
