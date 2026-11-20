/**
 * Every deployable process builds an image (ADR 0083, #682).
 *
 * The cluster's workloads are rendered from `FLEET` and `ORIGINS`
 * (`tools/cluster`), so a new service is a `Deployment` the moment it is
 * registered — and a `Deployment` naming an image no target builds is one the
 * up command would only find missing at pull time. So the convention is
 * checked where a project is declared: each `-service` has `container` over
 * the `prune` chain that makes its `dist` installable on its own, and each
 * `-app` has `container` over a standalone build.
 *
 * The scan pins how many projects it expects, the house rule `docs.spec.ts`
 * states, so a walk that quietly stops finding them fails rather than passes.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Target {
  readonly dependsOn?: readonly string[];
  readonly options?: { readonly command?: string };
}

const targetsOf = (project: string): Readonly<Record<string, Target>> =>
  (
    JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps', project, 'package.json'), 'utf8'),
    ) as { nx: { targets?: Record<string, Target> } }
  ).nx.targets ?? {};

const projects = (suffix: string) =>
  readdirSync(join(REPO_ROOT, 'apps')).filter(app => app.endsWith(suffix));

const SERVICES = projects('-service');
const APPS = projects('-app');

describe('every deployable process builds an image', () => {
  it('finds the projects it is meant to check', () => {
    expect(SERVICES).toHaveLength(12);
    expect(APPS).toHaveLength(2);
  });

  it.each(SERVICES)('%s builds its image from its pruned dist', service => {
    const targets = targetsOf(service);
    expect(targets['prune']?.dependsOn).toEqual([
      'prune-lockfile',
      'copy-workspace-modules',
    ]);
    expect(targets['container']?.dependsOn).toEqual(['prune']);
    expect(targets['container']?.options?.command).toBe(
      `node tools/docker/check-installs.cjs apps/${service}/dist && docker build -f tools/docker/service.Dockerfile -t r10c/${service}:local apps/${service}/dist`,
    );
  });

  it.each(APPS)('%s builds its image from a standalone build', app => {
    const targets = targetsOf(app);
    expect(targets['container']?.dependsOn).toEqual(['build']);
    expect(targets['container']?.options?.command).toBe(
      `docker build -f tools/docker/next.Dockerfile --build-arg APP=${app} -t r10c/${app}:local apps/${app}`,
    );
    const config = readFileSync(
      join(REPO_ROOT, 'apps', app, 'next.config.js'),
      'utf8',
    );
    expect(config).toMatch(/output:\s*'standalone'/);
    expect(config).toMatch(
      /outputFileTracingRoot:\s*join\(__dirname, '\.\.\/\.\.'\)/,
    );
  });
});

const { missingInstalls } = createRequire(import.meta.url)(
  join(REPO_ROOT, 'tools/docker/check-installs.cjs'),
) as { missingInstalls: (dist: string) => string[] };

describe('an image installs what its bundle requires', () => {
  const plant = (dependencies: Record<string, string>) => {
    const dist = mkdtempSync(join(tmpdir(), 'check-installs-'));
    writeFileSync(join(dist, 'package.json'), JSON.stringify({ dependencies }));
    writeFileSync(
      join(dist, 'main.js'),
      'require("mongodb"); require("effect/http"); require("node:fs"); require("path"); require("./chunk.js");',
    );
    return dist;
  };

  it('names a package the bundle requires and the manifest omits', () => {
    expect(missingInstalls(plant({ effect: '4.0.7' }))).toEqual(['mongodb']);
  });

  it('passes a manifest that installs every external', () => {
    expect(
      missingInstalls(plant({ effect: '4.0.7', mongodb: '7.9.0' })),
    ).toEqual([]);
  });
});
