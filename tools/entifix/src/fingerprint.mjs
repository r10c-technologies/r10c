#!/usr/bin/env node
/**
 * The Nx runtime input that keeps a synced entifix out of the task cache.
 *
 *   nx.json → namedInputs.sharedGlobals: [{ "runtime": "node tools/entifix/src/fingerprint.mjs" }]
 *
 * Prints nothing while the release is installed — including on a CI runner, or
 * before the first install — so every hash is what it was without this input.
 * See `fingerprint` in `markers.mjs` for why a synced copy needs one.
 *
 * ⚠️ It must never fail: Nx computes it for every task hash, so a throw here
 * breaks every command in the workspace. An unreadable store prints a fixed
 * marker instead, which misses the cache rather than trusting it.
 */
import { fingerprint, syncedEntifixPackages } from './markers.mjs';

try {
  process.stdout.write(fingerprint(syncedEntifixPackages(process.cwd())));
} catch {
  process.stdout.write('unreadable');
}
