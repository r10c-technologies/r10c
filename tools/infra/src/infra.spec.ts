import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FLEET_NAMESPACE, fleetManifests } from '@r10c/cluster';
import {
  ADDRESS_PLACEHOLDER as EDGE_ADDRESS,
  DOMAIN_PLACEHOLDER as EDGE_DOMAIN,
  ORIGINS,
  upstreamOf,
} from '@r10c/edge';
import { FLEET } from '@r10c/slices';
import { describe, expect, it } from 'vitest';

import { dryRunAnswer, parse } from './cli.js';
import { down, type Fleet, secretDocument, up } from './commands.js';
import { gcp, lab } from './environment.js';
import type { Io, RunOptions } from './io.js';
import { documents, stages, substitute } from './manifests.js';
import {
  GKE_SERVICE_RANGE,
  overlayKustomization,
  subtract,
  zitadelDenyList,
} from './overlay.js';
import { ADDRESS_PLACEHOLDER, DOMAIN_PLACEHOLDER } from './placeholders.js';
import {
  GENERATED_SECRETS,
  MINTED_SECRETS,
  PROVIDED_SECRETS,
} from './secrets.js';

const ROOT = join(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

const inputs = {
  services: FLEET,
  apps: ORIGINS.map(origin => ({
    project: origin.app,
    port: upstreamOf(origin),
  })),
};
const names = new Set(
  Object.values(fleetManifests(inputs))
    .flat()
    .map(doc => (doc as { metadata: { name: string } }).metadata.name),
);
const FLEET_RUN: Fleet = {
  projects: [...inputs.services, ...inputs.apps].map(({ project }) => project),
  names,
  deployments: ['order-service'],
};

const tfList = (name: string): string[] => {
  const block = new RegExp(`${name} = \\[([^\\]]*)\\]`, 'm').exec(
    read('infra/gcp/secrets.tf'),
  )?.[1];
  return [...(block ?? '').matchAll(/"([^"]+)"/g)].map(match => match[1] ?? '');
};

describe('what the up command and the cloud code agree on', () => {
  it('names the same secrets as infra/gcp/secrets.tf', () => {
    expect(tfList('generated_secrets')).toEqual([...GENERATED_SECRETS]);
    expect(tfList('minted_secrets')).toEqual([...MINTED_SECRETS]);
    expect(tfList('provided_secrets')).toEqual([...PROVIDED_SECRETS]);
  });

  it('grants the receipts bucket to order-service’s own account in the fleet’s namespace', () => {
    const storage = read('infra/gcp/storage.tf');

    expect(storage).toContain(
      `/subject/ns/${FLEET_NAMESPACE}/sa/order-service"`,
    );
    // The rendered manifest the cluster runs, not a fresh render: the grant
    // must name the account that is actually applied.
    expect(read('infra/cluster/fleet/order-service.yaml')).toMatch(
      /kind: ServiceAccount\nmetadata:\n {2}name: order-service\n/,
    );
  });

  it('substitutes the placeholders tools/edge writes', () => {
    expect(DOMAIN_PLACEHOLDER).toBe(EDGE_DOMAIN);
    expect(ADDRESS_PLACEHOLDER).toBe(EDGE_ADDRESS);
    expect(
      substitute(`hostname: shop.${EDGE_DOMAIN}\nvalue: '${EDGE_ADDRESS}'`, {
        domain: 'example.com',
        address: '203.0.113.10',
      }),
    ).toBe("hostname: shop.example.com\nvalue: '203.0.113.10'");
  });

  it('lets exactly the cluster’s Service range past Zitadel’s denylist', () => {
    const block =
      /DenyList:\n((?: {8}- .*\n)+)/.exec(
        read('infra/cluster/platform/zitadel.yaml'),
      )?.[1] ?? '';
    const committed = [...block.matchAll(/- '?([^'\n]+)'?/g)].map(
      match => match[1],
    );
    expect(committed).toEqual(zitadelDenyList(GKE_SERVICE_RANGE));
    expect(subtract('10.0.0.0/8', '10.0.0.0/8')).toEqual([]);
    expect(subtract('10.0.0.0/8', '192.168.0.0/16')).toEqual(['10.0.0.0/8']);
    expect(subtract('10.0.0.0/30', '10.0.0.1/32')).toEqual([
      '10.0.0.0/32',
      '10.0.0.2/31',
    ]);
  });
});

const doc = (kind: string, name: string, namespace?: string) =>
  [
    'apiVersion: v1',
    `kind: ${kind}`,
    'metadata:',
    `  name: ${name}`,
    ...(namespace === undefined ? [] : [`  namespace: ${namespace}`]),
    '',
  ].join('\n');

const RENDERED = [
  doc('CustomResourceDefinition', 'rabbitmqclusters.rabbitmq.com'),
  doc('Namespace', 'r10c'),
  doc('Deployment', 'cert-manager', 'cert-manager'),
  doc('ClusterRole', 'envoy-gateway'),
  doc('Certificate', 'cluster-operator-webhook', 'rabbitmq-system'),
  doc('Deployment', 'zitadel', 'r10c'),
  doc('Service', 'order-service', 'r10c'),
  doc('Deployment', 'order-service', 'r10c'),
  doc('ConfigMap', 'fleet-env', 'r10c'),
  doc('Gateway', 'r10c-edge', 'r10c'),
  doc('ClusterIssuer', 'letsencrypt'),
].join('---\n');

describe('the stages', () => {
  it('reads every document’s kind, name and namespace', () => {
    expect(
      documents(RENDERED).map(({ kind, name, namespace }) => [
        kind,
        name,
        namespace,
      ]),
    ).toEqual([
      ['CustomResourceDefinition', 'rabbitmqclusters.rabbitmq.com', undefined],
      ['Namespace', 'r10c', undefined],
      ['Deployment', 'cert-manager', 'cert-manager'],
      ['ClusterRole', 'envoy-gateway', undefined],
      ['Certificate', 'cluster-operator-webhook', 'rabbitmq-system'],
      ['Deployment', 'zitadel', 'r10c'],
      ['Service', 'order-service', 'r10c'],
      ['Deployment', 'order-service', 'r10c'],
      ['ConfigMap', 'fleet-env', 'r10c'],
      ['Gateway', 'r10c-edge', 'r10c'],
      ['ClusterIssuer', 'letsencrypt', undefined],
    ]);
  });

  it('puts every generated workload in the fleet, and the edge last', () => {
    const split = stages(documents(RENDERED), names);
    const named = (list: readonly { name: string }[]) => list.map(d => d.name);
    expect(named(split.definitions)).toEqual([
      'rabbitmqclusters.rabbitmq.com',
      'r10c',
    ]);
    expect(named(split.operators)).toEqual(['cert-manager', 'envoy-gateway']);
    expect(named(split.issued)).toEqual(['cluster-operator-webhook']);
    expect(named(split.platform)).toEqual(['zitadel']);
    expect(named(split.fleetServices)).toEqual(['order-service']);
    expect(named(split.fleet)).toEqual(['order-service', 'fleet-env']);
    expect(named(split.edge)).toEqual(['r10c-edge', 'letsencrypt']);
  });
});

describe('the overlay', () => {
  it('renames images for the cloud, and changes nothing else there', () => {
    const text = overlayKustomization('gcp', '../../cluster', [
      {
        name: 'r10c/order-service',
        newName: 'reg/order-service',
        newTag: 'abc',
      },
    ]);
    expect(text).toContain('newName: reg/order-service');
    expect(text).not.toContain('patches:');
  });

  it('gives the lab a disk minikube can make and an issuer it can reach', () => {
    const text = overlayKustomization('lab', '../../cluster', []);
    expect(text).toContain('k8s.io/minikube-hostpath');
    expect(text).toContain('"selfSigned":{}');
    expect(text).toContain("- '10.112.0.0/12'");
  });
});

/** Records every command; answers like `--dry-run`, from an in-memory disk. */
const recorder = () => {
  const commands: { argv: readonly string[]; options: RunOptions }[] = [];
  const files = new Map<string, string>();
  const io: Io = {
    run: (argv, options = {}) => {
      commands.push({ argv, options });
      if (argv[0] === 'kubectl' && argv[1] === 'kustomize')
        return { ok: true, stdout: RENDERED };
      if (argv[0] === 'kubectl' && argv[1] === 'config')
        return { ok: true, stdout: 'minikube' };
      if (argv.includes('cat'))
        return { ok: true, stdout: `pat-${argv.at(-1) ?? ''}-0123456789` };
      // The seed stands in for Zitadel: it writes what an instance mints.
      if (argv[1] === 'tools/zitadel-seed.mjs')
        files.set(
          options.env?.['ZITADEL_GENERATED_ENV'] ?? '',
          'ZITADEL_CLIENT_ID=client-0123456789\nZITADEL_PAT=pat-0123456789abc\nZITADEL_ACTION_SIGNING_KEY=key-0123456789abc\n',
        );
      return { ok: true, stdout: dryRunAnswer(argv) };
    },
    background: argv => {
      commands.push({ argv, options: {} });
      return { stop: () => undefined };
    },
    log: () => undefined,
    write: (path, text) => {
      files.set(path, text);
    },
    read: path => files.get(path),
    sleep: () => undefined,
  };
  return { io, commands, files };
};

const DESTRUCTIVE =
  /\b(delete|destroy|drop|remove|rm)\b|--delete|activation-policy=NEVER/i;

describe('down', () => {
  it('deletes nothing but the Gateway, in the cloud and in the lab', () => {
    for (const make of [(io: Io) => gcp(io, 2), (io: Io) => lab(io, '/repo')]) {
      const { io, commands } = recorder();
      down(io, make(io));
      const destructive = commands
        .map(({ argv }) => argv.join(' '))
        .filter(line => DESTRUCTIVE.test(line));
      expect(
        destructive.filter(line => !line.includes('activation-policy=NEVER')),
      ).toEqual([
        'kubectl -n r10c delete gateway r10c-edge --ignore-not-found',
      ]);
    }
  });

  it('stops Cloud SQL rather than deleting it, after the nodes', () => {
    const { io, commands } = recorder();
    down(io, gcp(io, 2));
    const lines = commands.map(({ argv }) => argv.join(' '));
    const nodes = lines.findIndex(line => line.includes('--num-nodes=0'));
    const autoscaling = lines.findIndex(line =>
      line.includes('--no-enable-autoscaling'),
    );
    const sql = lines.findIndex(line =>
      line.includes('--activation-policy=NEVER'),
    );
    expect(autoscaling).toBeGreaterThan(-1);
    expect(autoscaling).toBeLessThan(nodes);
    expect(nodes).toBeLessThan(sql);
  });
});

describe('up', () => {
  const rehearse = () => {
    const recorded = recorder();
    up(recorded.io, lab(recorded.io, '/repo'), {
      repoRoot: '/repo',
      fleet: FLEET_RUN,
      sha: 'abc',
    });
    return recorded;
  };

  it('applies in stages: the cluster seed once the identity provider minted its part, the fleet waited on once the edge serves', () => {
    const { commands } = rehearse();
    const lines = commands.map(({ argv, options }) =>
      argv[1] === 'apply'
        ? `apply ${/name: (\S+)/.exec(options.input ?? '')?.[1] ?? ''}`
        : argv.join(' '),
    );
    const at = (pattern: RegExp) => lines.findIndex(line => pattern.test(line));
    expect(at(/^apply rabbitmqclusters/)).toBeLessThan(
      at(/condition=Established/),
    );
    expect(at(/condition=Established/)).toBeLessThan(
      at(/^apply cert-manager$/),
    );
    expect(at(/^apply cloud-endpoints$/)).toBeLessThan(at(/^apply zitadel$/));
    expect(at(/zitadel-seed\.mjs/)).toBeLessThan(at(/^apply config-seed$/));
    expect(at(/^apply config-seed$/)).toBeLessThan(at(/^apply r10c-edge$/));
    // auth-service reaches Zitadel through the edge, so the fleet is waited
    // on only once the edge serves.
    expect(at(/^apply r10c-edge$/)).toBeLessThan(
      at(/rollout status deployment\/order-service/),
    );
  });

  it('never puts a secret value in a command line', () => {
    const { commands, files } = rehearse();
    const secrets = Object.values(
      JSON.parse(
        files.get('/repo/infra/.overlay/lab/secrets.json') ?? '{}',
      ) as Record<string, string>,
    ).filter(value => value.length > 8 && !value.startsWith('{'));
    expect(secrets.length).toBeGreaterThan(20);
    const argv = commands.map(({ argv }) => argv.join(' ')).join('\n');
    expect(secrets.filter(secret => argv.includes(secret))).toEqual([]);
  });
});

describe('the command line', () => {
  it('takes a command and a target', () => {
    expect(parse(['up', '--target', 'lab'])).toEqual({
      command: 'up',
      target: 'lab',
      dryRun: false,
      nodes: 2,
    });
    expect(() => parse(['up'])).toThrow('--target');
    expect(() => parse(['sideways', '--target', 'lab'])).toThrow('usage');
  });

  it('writes a Secret’s values encoded, never in plain text', () => {
    const text = secretDocument('fleet-token', { token: 'hunter2' });
    expect(text).toContain('token: aHVudGVyMg==');
    expect(text).not.toContain('hunter2');
  });
});
