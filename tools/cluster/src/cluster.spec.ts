/**
 * What the rendered fleet must say. The files' equality with this generator
 * is asserted by `@r10c/docs-check`, beside the edge's.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { ORIGINS, upstreamOf } from '@r10c/edge';
import { FLEET } from '@r10c/slices';
import { describe, expect, it } from 'vitest';

import {
  FLEET_TOKEN,
  fleetEnv,
  type FleetInputs,
  fleetKustomization,
  fleetManifests,
  serviceUrlVariable,
  workloads,
} from './fleet.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

/** The inputs `tools/generate-cluster.mjs` composes. */
const INPUTS: FleetInputs = {
  services: FLEET,
  apps: ORIGINS.map(origin => ({
    project: origin.app,
    port: upstreamOf(origin),
  })),
};

type Tree = Record<string, unknown>;
const tree = (value: unknown): Tree => value as Tree;
const list = (value: unknown): readonly unknown[] =>
  value as readonly unknown[];

const containerOf = (name: string): Tree => {
  const [deployment] = fleetManifests(INPUTS)[`${name}.yaml`] ?? [];
  const spec = tree(tree(tree(tree(deployment)['spec'])['template'])['spec']);
  return tree(list(spec['containers'])[0]);
};

/** Every source file under a directory, skipping builds and dependencies. */
const sources = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap(entry => {
    if (['node_modules', '.next', 'dist', 'out-tsc'].includes(entry)) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !entry.includes('.spec.') ? [path] : [];
  });

describe('the fleet in the cluster', () => {
  it('runs every registered service and every origin’s app, on its own port', () => {
    const byName = new Map(workloads(INPUTS).map(w => [w.name, w.port]));
    for (const { project, port } of FLEET)
      expect(byName.get(project)).toBe(port);
    for (const origin of ORIGINS)
      expect(byName.get(origin.app)).toBe(upstreamOf(origin));
  });

  it('gives transaction-service a runner-only replica, registered at its pod’s address', () => {
    const runner = containerOf('transaction-runner');
    expect(runner['command']).toEqual([
      'node',
      '--enable-source-maps',
      'runner.js',
    ]);
    expect(runner['image']).toBe('r10c/transaction-service:local');
    const env = list(runner['env']).map(tree);
    expect(env.find(e => e['name'] === 'WORKFLOW_REPLICA')?.['value']).toBe(
      '1',
    );
    expect(env.find(e => e['name'] === 'WORKFLOW_RUNNER_HOST')).toEqual({
      name: 'WORKFLOW_RUNNER_HOST',
      valueFrom: { fieldRef: { fieldPath: 'status.podIP' } },
    });
    expect(fleetManifests(INPUTS)['transaction-runner.yaml']).toHaveLength(2);
  });

  it('probes every HTTP process on its health routes, liveness apart from readiness', () => {
    for (const { name, probe } of workloads(INPUTS)) {
      if (probe !== 'http') continue;
      const container = containerOf(name);
      expect(
        tree(tree(container['livenessProbe'])['httpGet'])['path'],
        name,
      ).toBe('/api/health/live');
      expect(
        tree(tree(container['readinessProbe'])['httpGet'])['path'],
        name,
      ).toBe('/api/health/ready');
    }
  });

  it('reads the fleet token from a Secret, and renders no secret value', () => {
    for (const { name } of workloads(INPUTS)) {
      const token = list(containerOf(name)['env'])
        .map(tree)
        .find(e => e['name'] === 'CONFIG_SERVICE_TOKEN');
      expect(token, name).toEqual({
        name: 'CONFIG_SERVICE_TOKEN',
        valueFrom: { secretKeyRef: { name: FLEET_TOKEN, key: 'token' } },
      });
    }
    expect(JSON.stringify(fleetManifests(INPUTS))).not.toMatch(
      /dev-config-service-token/,
    );
  });

  it('names every service address the Next shells read, and nothing at localhost', () => {
    const data = tree(tree(fleetEnv(INPUTS))['data']);
    const read = new Set(
      [
        ...sources(join(REPO_ROOT, 'packages/shells/next')),
        ...sources(join(REPO_ROOT, 'apps/marketplace-app/src')),
        ...sources(join(REPO_ROOT, 'apps/back-office-app/src')),
      ].flatMap(file =>
        [
          ...readFileSync(file, 'utf8').matchAll(/\b([A-Z_]+_SERVICE_URL)\b/g),
        ].map(match => match[1] ?? ''),
      ),
    );
    expect(read.size).toBeGreaterThan(0);
    for (const variable of read)
      expect(Object.keys(data), variable).toContain(variable);
    expect(Object.values(data).join(' ')).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(data['CONFIG_API_URL']).toBe('http://config-service:3190');
    expect(serviceUrlVariable('marketplace-admin-service')).toBe(
      'MARKETPLACE_ADMIN_SERVICE_URL',
    );
  });

  it('runs each workload as its own account, with no API token mounted', () => {
    for (const [file, documents] of Object.entries(fleetManifests(INPUTS))) {
      if (file === 'fleet-env.yaml') continue;
      const byKind = new Map(
        documents.map(tree).map(document => [document['kind'], document]),
      );
      const account = byKind.get('ServiceAccount');
      const deployment = byKind.get('Deployment');
      const name = tree(account?.['metadata'])['name'];
      expect(account?.['kind'], file).toBe('ServiceAccount');
      expect(account?.['automountServiceAccountToken'], file).toBe(false);
      expect(
        tree(tree(tree(deployment?.['spec'])['template'])['spec'])[
          'serviceAccountName'
        ],
        file,
      ).toBe(name);
    }
  });

  it('lists every rendered file in its kustomization', () => {
    expect(tree(fleetKustomization(INPUTS))['resources']).toEqual(
      Object.keys(fleetManifests(INPUTS)),
    );
  });
});
