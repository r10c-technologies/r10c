/**
 * The guard against committing on top of a synced entifix build.
 *
 * Driven against a fake virtual store rather than this checkout's, because the
 * real one is supposed to hold no markers at all — a scan that finds nothing
 * there proves nothing about whether it could.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface SyncedPackage {
  name: string;
  version: string;
  source: string;
}

// Loaded by path, like `attribution.mjs` in `conventions.spec.ts`: the hook runs
// this file with plain Node, so it is `.mjs` with no declaration beside it.
const guard = (await import(
  join(import.meta.dirname, '..', 'entifix-dev-sync.mjs')
)) as {
  syncedEntifixPackages: (root: string) => SyncedPackage[];
  formatSyncedFindings: (packages: SyncedPackage[]) => string;
};
const { formatSyncedFindings, syncedEntifixPackages } = guard;

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
  root = mkdtempSync(join(tmpdir(), 'entifix-dev-sync-'));
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

describe('formatSyncedFindings', () => {
  it('names the source, every package and both ways out', () => {
    const message = formatSyncedFindings([
      { name: '@entifix/core', version: '0.1.1-dev.1', source: 'abc1234' },
    ]);

    expect(message).toContain('synced from abc1234');
    expect(message).toContain('@entifix/core@0.1.1-dev.1');
    expect(message).toContain('pnpm install --force');
    expect(message).toContain('ENTIFIX_DEV_SYNC_OK=1');
  });
});
