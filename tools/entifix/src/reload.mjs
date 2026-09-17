#!/usr/bin/env node
/**
 * Restarts the running services a sync changed, for as long as `entifix:local`
 * runs. Started by `local.sh` beside entifix's `dev-sync`.
 *
 *   node tools/entifix/src/reload.mjs
 *
 * It polls the synced versions rather than watching files: the sync writes each
 * copy file by file into a store with thousands of entries, and what marks a
 * finished copy is the `<release>-dev.<timestamp>` version it stamps. A change
 * is acted on only once the versions have held still for one settle interval,
 * so a sync still in progress restarts nothing, and one burst of saves restarts
 * each service once.
 *
 * Starting the loop reads the current versions as its baseline, so a checkout
 * that is already synced is not restarted on launch.
 */
import {
  affectedPackages,
  changedPackages,
  entifixDependencies,
  formatRestart,
  servicesToRestart,
  syncedVersions,
  touch,
  workspaceManifests,
} from './consumers.mjs';

const root = process.cwd();
const POLL_MS = Number(process.env.ENTIFIX_RELOAD_POLL_MS ?? 1000);
const SETTLE_MS = Number(process.env.ENTIFIX_RELOAD_SETTLE_MS ?? 1500);

let applied = syncedVersions(root);
let pending = applied;
let pendingSince = 0;

const tick = () => {
  let current;
  try {
    current = syncedVersions(root);
  } catch {
    // A manifest caught mid-write reads as invalid JSON; the next poll sees it whole.
    return;
  }
  if (changedPackages(pending, current).length > 0) {
    pending = current;
    pendingSince = Date.now();
    return;
  }
  const changed = changedPackages(applied, pending);
  if (changed.length === 0 || Date.now() - pendingSince < SETTLE_MS) return;

  const affected = affectedPackages(changed, entifixDependencies(root));
  const services = servicesToRestart(workspaceManifests(root), affected);
  touch(root, services);
  applied = pending;
  console.log(formatRestart(changed, services));
};

setInterval(tick, POLL_MS);
console.log(
  'entifix:reload: watching synced versions — a sync restarts the services that run it.',
);
