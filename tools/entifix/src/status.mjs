#!/usr/bin/env node
/**
 * Which `@entifix/*` this checkout runs: the release, or copies synced from a
 * local entifix checkout, with the commit each was built from.
 *
 *   node tools/entifix/src/status.mjs
 */
import { formatStatus, syncedEntifixPackages } from './markers.mjs';

console.log(formatStatus(syncedEntifixPackages(process.cwd())));
