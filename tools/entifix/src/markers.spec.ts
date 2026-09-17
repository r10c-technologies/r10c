/**
 * The marker reader behind the commit guard, the status report, the cache
 * fingerprint and the restore.
 *
 * Driven against a fake virtual store rather than this checkout's, because the
 * real one is supposed to hold no markers at all — a scan that finds nothing
 * there proves nothing about whether it could.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface SyncedPackage {
  name: string;
  version: string;
  source: string;
}

// Loaded by path: a hook and an Nx runtime input run these files with plain
// Node, so they are `.mjs` with no declaration beside them.
const markers = (await import(join(import.meta.dirname, 'markers.mjs'))) as {
  syncedEntifixPackages: (root: string) => SyncedPackage[];
  syncedEntifixEntries: (root: string) => string[];
  restoreRelease: (root: string, install: (root: string) => void) => number;
  fingerprint: (packages: SyncedPackage[]) => string;
  formatStatus: (packages: SyncedPackage[]) => string;
  formatSyncedFindings: (packages: SyncedPackage[]) => string;
};
const {
  fingerprint,
  formatStatus,
  formatSyncedFindings,
  restoreRelease,
  syncedEntifixEntries,
  syncedEntifixPackages,
} = markers;

/** Runs one of the kit's command-line entry points in a checkout. */
const run = (script: string, cwd: string) =>
  execFileSync(process.execPath, [join(import.meta.dirname, script)], {
    cwd,
    encoding: 'utf8',
  });

let root: string;

const copy = (entry: string, name: string, manifest: object) => {
  const dir = join(
    root,
    'node_modules/.pnpm',
    entry,
    'node_modules/@entifix',
    name,
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
};

const synced = (name: string) => ({
  name: `@entifix/${name}`,
  version: '0.1.1-dev.1',
  entifixDevSync: { source: 'abc1234', at: '2026-09-16T00:00:00.000Z' },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'entifix-swap-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('syncedEntifixPackages', () => {
  it('finds nothing in a checkout with no install', () => {
    expect(syncedEntifixPackages(root)).toEqual([]);
  });

  it('reports each synced package once, whatever its peer-set copies', () => {
    copy('@entifix+core@0.1.1', 'core', synced('core'));
    copy('@entifix+core@0.1.1_effect@3.22.1', 'core', synced('core'));
    copy('@entifix+authz@0.1.1', 'authz', synced('authz'));
    // A release copy, a non-entifix entry and an entry with no package inside.
    copy('@entifix+rest@0.1.1', 'rest', {
      name: '@entifix/rest',
      version: '0.1.1',
    });
    mkdirSync(join(root, 'node_modules/.pnpm/effect@3.22.1'), {
      recursive: true,
    });
    mkdirSync(join(root, 'node_modules/.pnpm/@entifix+sql@0.1.1'), {
      recursive: true,
    });
    mkdirSync(
      join(
        root,
        'node_modules/.pnpm/@entifix+jwt@0.1.1/node_modules/@entifix/jwt',
      ),
      {
        recursive: true,
      },
    );

    expect(syncedEntifixPackages(root)).toEqual([
      { name: '@entifix/authz', version: '0.1.1-dev.1', source: 'abc1234' },
      { name: '@entifix/core', version: '0.1.1-dev.1', source: 'abc1234' },
    ]);
  });
});

describe('restoreRelease', () => {
  it('deletes only entries whose own package is synced, then installs once', () => {
    copy('@entifix+core@0.1.1', 'core', synced('core'));
    copy('@entifix+core@0.1.1_effect@3.22.1', 'core', synced('core'));
    // A release entry that links the synced core beside its own package.
    copy('@entifix+amqp@0.1.1', 'amqp', {
      name: '@entifix/amqp',
      version: '0.1.1',
    });
    copy('@entifix+amqp@0.1.1', 'core', synced('core'));
    const store = join(root, 'node_modules/.pnpm');

    expect(syncedEntifixEntries(root)).toEqual([
      join(store, '@entifix+core@0.1.1'),
      join(store, '@entifix+core@0.1.1_effect@3.22.1'),
    ]);

    const installs: string[] = [];
    expect(restoreRelease(root, dir => installs.push(dir))).toBe(2);
    expect(installs).toEqual([root]);
    expect(syncedEntifixEntries(root)).toEqual([]);
    expect(syncedEntifixPackages(root)).toEqual([
      { name: '@entifix/core', version: '0.1.1-dev.1', source: 'abc1234' },
    ]);
  });

  it('installs nothing when nothing is synced', () => {
    const installs: string[] = [];
    expect(restoreRelease(root, dir => installs.push(dir))).toBe(0);
    expect(syncedEntifixEntries(root)).toEqual([]);
    expect(installs).toEqual([]);
  });
});

describe('formatSyncedFindings', () => {
  it('names the source, every package and both ways out', () => {
    const message = formatSyncedFindings([
      { name: '@entifix/core', version: '0.1.1-dev.1', source: 'abc1234' },
    ]);

    expect(message).toContain('synced from abc1234');
    expect(message).toContain('@entifix/core@0.1.1-dev.1');
    expect(message).toContain('guard.mjs --restore');
    expect(message).toContain('ENTIFIX_DEV_SYNC_OK=1');
  });
});

describe('fingerprint', () => {
  it('is empty on the release, so every task hash stays what it was', () => {
    expect(fingerprint([])).toBe('');
  });

  it('is stable for one sync and changes with the next', () => {
    const first = [
      { name: '@entifix/core', version: '0.1.2-dev.1', source: 'abc1234' },
    ];
    const next = [
      { name: '@entifix/core', version: '0.1.2-dev.2', source: 'abc1234' },
    ];

    expect(fingerprint(first)).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint(first)).toBe(fingerprint(first));
    expect(fingerprint(next)).not.toBe(fingerprint(first));
  });
});

describe('formatStatus', () => {
  it('says release when nothing is synced', () => {
    expect(formatStatus([])).toContain('the release');
  });

  it('names every synced package and the commit it came from', () => {
    const message = formatStatus([
      { name: '@entifix/core', version: '0.1.2-dev.1', source: 'abc1234' },
    ]);

    expect(message).toContain('1 package(s) synced');
    expect(message).toContain('@entifix/core@0.1.2-dev.1  (from abc1234)');
  });
});

describe('fingerprint.mjs', () => {
  it('prints nothing where nothing is installed, as on a CI runner', () => {
    expect(run('fingerprint.mjs', root)).toBe('');
  });

  it('prints the digest of what is synced', () => {
    copy('@entifix+core@0.1.1', 'core', synced('core'));

    expect(run('fingerprint.mjs', root)).toBe(
      fingerprint(syncedEntifixPackages(root)),
    );
  });

  it('misses the cache rather than failing every task on an unreadable store', () => {
    const dir = join(
      root,
      'node_modules/.pnpm/@entifix+core@0.1.1/node_modules/@entifix/core',
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{ not json');

    expect(run('fingerprint.mjs', root)).toBe('unreadable');
  });
});

describe('guard.mjs and status.mjs', () => {
  it('pass and report the release when nothing is synced', () => {
    expect(run('guard.mjs', root)).toBe('');
    expect(run('status.mjs', root)).toContain('the release');
  });

  it('refuses while a copy is synced, and lets one through on purpose', () => {
    copy('@entifix+core@0.1.1', 'core', synced('core'));

    expect(() =>
      execFileSync(process.execPath, [join(import.meta.dirname, 'guard.mjs')], {
        cwd: root,
        stdio: 'pipe',
        env: { ...process.env, ENTIFIX_DEV_SYNC_OK: '' },
      }),
    ).toThrow(/unreleased entifix/);
    expect(
      execFileSync(process.execPath, [join(import.meta.dirname, 'guard.mjs')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, ENTIFIX_DEV_SYNC_OK: '1' },
      }),
    ).toBe('');
    expect(run('status.mjs', root)).toContain('@entifix/core@0.1.1-dev.1');
  });
});
