/**
 * Which fleet the live pass runs against, from `FLEET_TARGET` (#704). It is
 * not a third `E2E_PROFILE`: that is entifix's `mock | live`, and against a
 * cluster the pass is as live as against the dev fleet — what differs is
 * where the fleet runs.
 *
 * - **`local`** (the default) — the dev fleet on this machine: every service a local process
 *   on its canonical port, the lab's Mongo and Mailpit on their NodePorts.
 * - **`cluster`** — the fleet running in a cluster, reached through
 *   `pnpm run infra:forward`, which writes what this reads into
 *   `infra/.overlay/<target>/e2e.env`. Nothing here is a local process, so
 *   no spec may kill one: `vitest.config.mts` leaves those files out. A
 *   mailbox exists only where the cluster mails a Mailpit (the lab
 *   rehearsal); in the cloud the mail goes to a real provider, which offers
 *   nothing to read back, and a real inbox is the apply-day check.
 */
const name = process.env['FLEET_TARGET'] === 'cluster' ? 'cluster' : 'local';

export const PROFILE = {
  name,
  /** Whether the fleet's processes are this machine's, to kill and restart. */
  processes: name === 'local',
  /** Mailpit's API, where the fleet's mail can be read back — if anywhere. */
  mailbox:
    process.env['MAILPIT_API_URL'] ??
    (name === 'local' ? 'http://localhost:30826' : undefined),
} as const;
