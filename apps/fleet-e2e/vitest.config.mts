import { defineEntifixTest } from '../../vitest.shared.mjs';

/**
 * The live pass (#492): the whole fleet, every participant and both flow
 * runners, driven at once — races, killed processes and a stream under load.
 *
 * **Live only** — against the dev fleet, or with `FLEET_TARGET=cluster`
 * against one in a cluster (`support/profile.ts`). There is no `mock` half to this suite, because what it proves
 * is exactly what a mock cannot hold: two processes racing on one record, a
 * runner dying mid-flow, a broker's fan-out. Under the default `mock` profile
 * every spec is left uncollected and the run is empty rather than green by
 * skipping — the same selection by filename every e2e project uses.
 *
 * **One file at a time.** The specs kill and restart fleet processes, so two
 * files running together would measure each other's outages.
 */
const live = process.env['E2E_PROFILE'] === 'live';
const cluster = process.env['FLEET_TARGET'] === 'cluster';

/**
 * The files that kill and restart fleet processes by port
 * (`support/processes.ts`). Against a cluster (#704) there is no local
 * process to kill — only a port-forward — so `FLEET_TARGET=cluster` leaves them
 * out by name, as `mock` leaves out every live file: uncollected, never
 * skipped green. A pod's death is the platform's to prove, not this pass's.
 */
const KILLS_PROCESSES = [
  'src/commerce/runner-kill.live.spec.ts',
  'src/realtime/restart.live.spec.ts',
  'src/realtime/fanout.live.spec.ts',
];

export default defineEntifixTest({
  name: '@r10c/fleet-e2e',
  root: import.meta.dirname,
  thresholds: false,
  exclude: !live ? ['**/*.live.spec.ts'] : cluster ? KILLS_PROCESSES : [],
  hookTimeout: 120_000,
  testTimeout: 300_000,
  fileParallelism: false,
});
