/**
 * Which running services a sync restarts.
 *
 * Driven against a fake consumer — a virtual store and a git repository of
 * manifests — because the real checkout holds no synced copies, and a selection
 * that finds nothing to restart there proves nothing about whether it could.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

interface Service {
  name: string;
  path: string;
}
interface WorkspaceManifest {
  path: string;
  manifest: Record<string, unknown>;
}

// Loaded by path, like `markers.spec.ts`: the kit is plain `.mjs` run by Node.
const consumers = (await import(
  join(import.meta.dirname, 'consumers.mjs')
)) as {
  RESTARTING_EXECUTOR: string;
  syncedVersions: (root: string) => Map<string, string>;
  changedPackages: (
    before: Map<string, string>,
    after: Map<string, string>,
  ) => string[];
  entifixDependencies: (root: string) => Map<string, Set<string>>;
  affectedPackages: (
    changed: string[],
    dependencies: Map<string, Set<string>>,
  ) => Set<string>;
  workspaceManifests: (root: string) => WorkspaceManifest[];
  servicesToRestart: (
    manifests: WorkspaceManifest[],
    affected: Set<string>,
  ) => Service[];
  touch: (root: string, services: Service[], now?: Date) => void;
  formatRestart: (
    changed: string[],
    services: Service[],
    event?: string,
  ) => string;
};
const {
  RESTARTING_EXECUTOR,
  affectedPackages,
  changedPackages,
  entifixDependencies,
  formatRestart,
  servicesToRestart,
  syncedVersions,
  touch,
  workspaceManifests,
} = consumers;

let root: string;

const write = (path: string, contents: object) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify(contents));
};

/** One store entry, `@entifix+<name>@<version>`, holding its own manifest. */
const installed = (
  name: string,
  manifest: {
    version?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    synced?: boolean;
  } = {},
) =>
  write(
    `node_modules/.pnpm/@entifix+${name}@0.1.2/node_modules/@entifix/${name}/package.json`,
    {
      name: `@entifix/${name}`,
      version: manifest.version ?? '0.1.2',
      dependencies: manifest.dependencies,
      peerDependencies: manifest.peerDependencies,
      ...(manifest.synced && {
        entifixDevSync: { source: 'abc1234', at: '2026-09-17T00:00:00.000Z' },
      }),
    },
  );

const service = (
  dir: string,
  dependencies: Record<string, string>,
  executor = RESTARTING_EXECUTOR,
) => ({
  path: `apps/${dir}/package.json`,
  manifest: {
    name: `@acme/${dir}`,
    dependencies,
    nx: { targets: { dev: { executor } } },
  },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'entifix-reload-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('what a sync changed', () => {
  it('reads nothing on the release', () => {
    installed('core');
    expect(syncedVersions(root)).toEqual(new Map());
  });

  it('reads the version each synced copy carries', () => {
    installed('core', { version: '0.1.2-dev.7', synced: true });
    installed('mongo');
    expect(syncedVersions(root)).toEqual(
      new Map([['@entifix/core', '0.1.2-dev.7']]),
    );
  });

  it('names a package that was re-synced, newly synced or put back', () => {
    const before = new Map([
      ['@entifix/core', '0.1.2-dev.1'],
      ['@entifix/jwt', '0.1.2-dev.1'],
      ['@entifix/sql', '0.1.2-dev.1'],
    ]);
    const after = new Map([
      ['@entifix/core', '0.1.2-dev.2'],
      ['@entifix/mongo', '0.1.2-dev.2'],
      ['@entifix/sql', '0.1.2-dev.1'],
    ]);
    expect(changedPackages(before, after)).toEqual([
      '@entifix/core',
      '@entifix/jwt',
      '@entifix/mongo',
    ]);
  });

  it('names nothing when the versions held still', () => {
    const versions = new Map([['@entifix/core', '0.1.2-dev.1']]);
    expect(changedPackages(versions, new Map(versions))).toEqual([]);
  });
});

describe('which entifix packages a change reaches', () => {
  it('reads each store entry for its own package only', () => {
    installed('core');
    installed('service-shell', {
      dependencies: { '@entifix/core': '0.1.2', effect: '3' },
      peerDependencies: { '@entifix/mongo': '0.1.2' },
    });
    // The entry for service-shell also links core beside it; that link must not
    // be read as a second service-shell.
    write(
      'node_modules/.pnpm/@entifix+service-shell@0.1.2/node_modules/@entifix/core/package.json',
      { name: '@entifix/core', dependencies: { '@entifix/jwt': '0.1.2' } },
    );
    expect(entifixDependencies(root)).toEqual(
      new Map([
        ['@entifix/core', new Set()],
        ['@entifix/service-shell', new Set(['@entifix/core', '@entifix/mongo'])],
      ]),
    );
  });

  it('reads nothing without a virtual store', () => {
    expect(entifixDependencies(root)).toEqual(new Map());
  });

  it('follows dependents transitively', () => {
    const dependencies = new Map([
      ['@entifix/core', new Set<string>()],
      ['@entifix/business', new Set(['@entifix/core'])],
      ['@entifix/service-shell', new Set(['@entifix/business'])],
      ['@entifix/style', new Set<string>()],
    ]);
    expect(affectedPackages(['@entifix/core'], dependencies)).toEqual(
      new Set(['@entifix/core', '@entifix/business', '@entifix/service-shell']),
    );
  });
});

describe('which services restart', () => {
  it('restarts a node service that names an affected package', () => {
    const manifests = [
      service('config-service', { '@entifix/service-shell': 'catalog:' }),
      service('stock-service', { '@entifix/mongo': 'catalog:' }),
    ];
    expect(
      servicesToRestart(manifests, new Set(['@entifix/service-shell'])),
    ).toEqual([
      { name: '@acme/config-service', path: 'apps/config-service/package.json' },
    ]);
  });

  it('never restarts a project whose dev is not an @nx/js:node restart', () => {
    // A Next dev server serves the sync by itself.
    const manifests = [
      service(
        'back-office-app',
        { '@entifix/service-shell': 'catalog:' },
        'nx:run-commands',
      ),
      { path: 'package.json', manifest: { name: 'root' } },
    ];
    expect(
      servicesToRestart(manifests, new Set(['@entifix/service-shell'])),
    ).toEqual([]);
  });

  it('reads the tracked manifests of a git checkout', () => {
    const { path, manifest } = service('config-service', {
      '@entifix/core': 'catalog:',
    });
    write(path, manifest);
    write('node_modules/ignored/package.json', { name: 'ignored' });
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', path], { cwd: root });
    expect(workspaceManifests(root)).toEqual([{ path, manifest }]);
  });

  it('fires a restart by moving the manifest mtime and nothing else', () => {
    const { path, manifest } = service('config-service', {});
    write(path, manifest);
    const now = new Date('2030-01-01T00:00:00.000Z');
    touch(root, [{ name: '@acme/config-service', path }], now);
    expect(statSync(join(root, path)).mtime).toEqual(now);
  });

  it('says what it restarted, or that nothing depends on the change', () => {
    expect(
      formatRestart(
        ['@entifix/core'],
        [
          { name: '@acme/auth-service', path: 'a' },
          { name: '@acme/config-service', path: 'b' },
        ],
      ),
    ).toBe(
      'entifix:reload: @entifix/core synced — restarting @acme/auth-service, @acme/config-service.',
    );
    expect(formatRestart(['@entifix/style'], [])).toBe(
      'entifix:reload: @entifix/style synced — no running service depends on it.',
    );
    expect(
      formatRestart(
        ['@entifix/core'],
        [{ name: '@acme/auth-service', path: 'a' }],
        'put back',
      ),
    ).toBe(
      'entifix:reload: @entifix/core put back — restarting @acme/auth-service.',
    );
  });
});
