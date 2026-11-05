import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import path from 'node:path';

import { eventually } from './lab';

/**
 * Killing and restarting fleet processes, by the port each one listens on.
 *
 * ⚠️ **A killed process is restarted from its build, not by Nx.** The dev
 * targets restart a service when its build changes, never when it dies, so a
 * runner SIGKILLed under `back-office:dev` stays dead until something rebuilds
 * it (measured in #488). The pass starts the replacement itself, detached, from
 * the same `dist` Nx would run, and leaves it running: the fleet it hands back
 * is whole, though that one process is no longer Nx's — restart the fleet
 * before working in it again.
 */
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const LOGS = path.join(ROOT, 'apps/fleet-e2e/test-output/processes');

/** The pid listening on `port`, if any. */
export const pidOn = (port: number): number | undefined => {
  try {
    const out = execFileSync(
      'lsof',
      ['-ti', `tcp:${String(port)}`, '-sTCP:LISTEN'],
      { encoding: 'utf8' },
    ).trim();
    const pid = Number(out.split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    // `lsof` exits 1 when nothing matches.
    return undefined;
  }
};

export const listening = (port: number) => pidOn(port) !== undefined;

/** Signals whatever listens on `port`, and waits for the port to close. */
export const kill = async (port: number, signal: NodeJS.Signals) => {
  const pid = pidOn(port);
  if (pid === undefined) throw new Error(`nothing listens on ${String(port)}`);
  process.kill(pid, signal);
  await eventually(
    () => Promise.resolve(listening(port)),
    open => !open,
    { timeoutMs: 30_000, what: `port ${String(port)} to close` },
  );
  return pid;
};

/**
 * Starts `entry` (a path under the repository root) detached, and waits for
 * `port` to listen. `NODE_OPTIONS` is cleared: an Nx e2e run sets the
 * `@r10c/source` condition in it, which a built service must not resolve with.
 */
export const restart = async (
  entry: string,
  port: number,
  env: Record<string, string> = {},
) => {
  mkdirSync(LOGS, { recursive: true });
  const log = openSync(
    path.join(
      LOGS,
      `${path.basename(path.dirname(path.dirname(entry)))}-${String(port)}.log`,
    ),
    'a',
  );
  const inherited = { ...process.env };
  delete inherited['NODE_OPTIONS'];
  const child = spawn(process.execPath, [path.join(ROOT, entry)], {
    cwd: ROOT,
    // A built service resolves its externals from pnpm's virtual store, which
    // `pnpm run` puts on `NODE_PATH` and a bare `node` does not.
    env: {
      ...inherited,
      NODE_PATH: path.join(ROOT, 'node_modules/.pnpm/node_modules'),
      ...env,
    },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  await eventually(
    () => Promise.resolve(listening(port)),
    open => open,
    {
      timeoutMs: 90_000,
      everyMs: 500,
      what: `${entry} to listen on ${String(port)}`,
    },
  );
};

/** One sample of a process's resident memory and open sockets. */
export const sample = (port: number) => {
  const pid = pidOn(port);
  if (pid === undefined) return undefined;
  const rssKb = Number(
    execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim(),
  );
  const sockets = (() => {
    try {
      return execFileSync('lsof', ['-a', '-i', 'TCP', '-p', String(pid)], {
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .slice(1).length;
    } catch {
      // `lsof` exits 1 when the process holds none.
      return 0;
    }
  })();
  return { pid, rssMb: Math.round(rssKb / 1024), sockets };
};
