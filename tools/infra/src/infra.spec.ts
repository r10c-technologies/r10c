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

import {
  type Census,
  censusLines,
  diffCensus,
  durableQueues,
  expiries,
  podManifest,
  summary,
} from './census.js';
import { dryRunAnswer, parse } from './cli.js';
import { down, type Fleet, secretDocument, up } from './commands.js';
import { cost, costQuery, costRows, costTable } from './cost.js';
import { gcp, lab } from './environment.js';
import { forward } from './forward.js';
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
  services: inputs.services,
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

/** A recorder whose lab has been brought up once, so its secrets exist. */
const upInLab = () => {
  const recorded = recorder();
  up(recorded.io, lab(recorded.io, '/repo'), {
    repoRoot: '/repo',
    fleet: FLEET_RUN,
    sha: 'abc',
  });
  return recorded;
};

describe('down', () => {
  it('deletes nothing but the Gateway, in the cloud and in the lab', () => {
    for (const target of ['gcp', 'lab'] as const) {
      const { io, commands } = target === 'gcp' ? recorder() : upInLab();
      commands.length = 0;
      down(io, target === 'gcp' ? gcp(io, 2) : lab(io, '/repo'), '/repo');
      const destructive = commands
        .map(({ argv }) => argv.join(' '))
        .filter(line => DESTRUCTIVE.test(line));
      expect(
        destructive.filter(
          line =>
            !line.includes('activation-policy=NEVER') &&
            // The census's own pod and the Secret it read from: made by the
            // census, holding nothing the fleet keeps.
            !/delete (pod|secret) r10c-census /.test(line),
        ),
      ).toEqual([
        'kubectl -n r10c delete gateway r10c-edge --ignore-not-found',
      ]);
    }
  });

  it('counts what the fleet holds before it stops anything, and keeps the count', () => {
    const { io, commands, files } = upInLab();
    commands.length = 0;
    down(io, lab(io, '/repo'), '/repo');
    const lines = commands.map(({ argv }) => argv.join(' '));
    const counted = lines.findIndex(line => line.includes('rabbitmqctl'));
    const gateway = lines.findIndex(line => line.includes('delete gateway'));
    const stopped = lines.findIndex(line => line.includes('--replicas=0'));
    expect(counted).toBeGreaterThan(-1);
    expect(counted).toBeLessThan(gateway);
    expect(gateway).toBeLessThan(stopped);
    const census = JSON.parse(
      files.get('/repo/infra/.overlay/lab/census.json') ?? '{}',
    ) as Census;
    expect(census.mongo).toEqual({ order: { 'product-order': 1 } });
    expect(census.queues).toEqual(['order-service.payment-captured']);
    // The lab keeps receipts inside the pod, declared gone with it.
    expect(census.objects).toBeUndefined();
  });

  it('keeps the last census when the fleet is already down', () => {
    const { io, commands, files } = upInLab();
    files.set('/repo/infra/.overlay/lab/census.json', 'kept');
    const run = io.run;
    const downAlready: Io = {
      ...io,
      run: (argv, options) =>
        argv.includes('gateway') && argv.includes('get')
          ? { ok: true, stdout: '' }
          : run(argv, options),
    };
    commands.length = 0;
    down(downAlready, lab(downAlready, '/repo'), '/repo');
    expect(commands.some(({ argv }) => argv.includes('r10c-census'))).toBe(
      false,
    );
    expect(files.get('/repo/infra/.overlay/lab/census.json')).toBe('kept');
  });

  it('stops Cloud SQL rather than deleting it, after the nodes', () => {
    const { io, commands } = recorder();
    down(io, gcp(io, 2), '/repo');
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

describe('the census', () => {
  const at = (takenAt: number, over: Partial<Census> = {}): Census => ({
    takenAt,
    mongo: { order: { 'product-order': 3, outbox: 2 }, tenant_a: { offer: 5 } },
    sql: { config: { 'public.configuration': 9 }, workflow: {} },
    redis: { forever: null, later: 10_000, soon: 1_500 },
    queues: ['a', 'b'],
    objects: 4,
    ...over,
  });

  it('finds nothing lost when everything is still there, or more of it', () => {
    expect(diffCensus(at(1000), at(2000))).toEqual([]);
    expect(
      diffCensus(
        at(1000),
        at(2000, {
          mongo: {
            order: { 'product-order': 4, outbox: 2, extra: 1 },
            tenant_a: { offer: 5 },
            tenant_b: { offer: 1 },
          },
          queues: ['a', 'b', 'c'],
          objects: 6,
        }),
      ),
    ).toEqual([]);
  });

  it('names every loss: a database, a collection, a count, a queue, a receipt', () => {
    expect(
      diffCensus(
        at(1000),
        at(2000, {
          mongo: { order: { 'product-order': 2 } },
          sql: { config: {}, workflow: {} },
          queues: ['a'],
          objects: 3,
        }),
      ),
    ).toEqual([
      'mongo order.product-order: 3 → 2',
      'mongo order.outbox: gone (held 2)',
      'mongo tenant_a: the database is gone',
      'postgres config.public.configuration: gone (held 9)',
      'rabbitmq b: the queue is gone',
      'payment-evidence: 4 → 3 objects',
    ]);
  });

  it('counts a key gone before its expiry as lost, and one past it as expired', () => {
    // At 2000 `soon` (1500) was due; `forever` and `later` were not.
    expect(diffCensus(at(1000), at(2000, { redis: {} }))).toEqual([
      'redis: 2 keys gone before they were due to expire',
    ]);
    expect(
      diffCensus(
        at(1000),
        at(2000, { redis: { forever: null, later: 10_000 } }),
      ),
    ).toEqual([]);
  });

  it('reads Redis TTLs as instants, and only durable queues', () => {
    expect(expiries({ a: -1, b: 500 }, 1000)).toEqual({ a: null, b: 1500 });
    expect(
      durableQueues(
        '[{"name":"z","durable":true},{"name":"push","durable":false},{"name":"a","durable":true}]',
      ),
    ).toEqual(['a', 'z']);
    expect(durableQueues('')).toEqual([]);
    expect(censusLines('noise\nCENSUS {"a":1}\npod deleted')).toEqual([
      '{"a":1}',
    ]);
  });

  it('gives the pod its credentials by Secret reference, never by value', () => {
    const pod = podManifest('r10c', 'redis.r10c.svc.cluster.local');
    expect(pod).toContain('secretKeyRef');
    expect(pod).not.toMatch(/mongodb:\/\/|postgres:\/\/|redis:\/\//);
  });

  it('says which engine answered what, when one answers no count', () => {
    const { io } = upInLab();
    const run = io.run;
    const refused: Io = {
      ...io,
      run: (argv, options) =>
        argv.includes('logs') && argv.at(-1) === 'redis'
          ? { ok: true, stdout: 'CENSUS NOAUTH Authentication required.' }
          : run(argv, options),
    };
    expect(() => down(refused, lab(refused, '/repo'), '/repo')).toThrow(
      'the census read no Redis keys: NOAUTH Authentication required.',
    );
  });

  it('says what it counted in one line', () => {
    expect(summary(at(1000))).toBe(
      '10 documents in 3 collections, 9 rows, 3 keys, 2 durable queues, 4 receipts',
    );
  });

  it('fails an up that holds less than the last down counted', () => {
    const { io, files } = upInLab();
    files.set(
      '/repo/infra/.overlay/lab/census.json',
      JSON.stringify(at(1000, { mongo: { order: { 'product-order': 5 } } })),
    );
    expect(() =>
      up(io, lab(io, '/repo'), {
        repoRoot: '/repo',
        fleet: FLEET_RUN,
        sha: 'abc',
      }),
    ).toThrow(/mongo order\.product-order: 5 → 1/);
  });

  it('passes an up that holds all of it', () => {
    const { io, files } = upInLab();
    files.set(
      '/repo/infra/.overlay/lab/census.json',
      JSON.stringify(
        at(1000, {
          mongo: { order: { 'product-order': 1 } },
          sql: { config: {}, workflow: {} },
          redis: {},
          queues: [],
          objects: undefined,
        }),
      ),
    );
    expect(() =>
      up(io, lab(io, '/repo'), {
        repoRoot: '/repo',
        fleet: FLEET_RUN,
        sha: 'abc',
      }),
    ).not.toThrow();
  });
});

describe('the bill', () => {
  it('sums each day per service, net of credits, from the standard export', () => {
    const sql = costQuery('r10c-demo', 'billing_export', 7);
    expect(sql).toContain('`r10c-demo.billing_export.gcp_billing_export_v1_*`');
    expect(sql).toContain('UNNEST(credits)');
    expect(sql).toContain('INTERVAL 7 DAY');
  });

  it('prints a line a day, its total first, and drops what cost under a cent', () => {
    const rows = costRows(dryRunAnswer(['bq', 'query']));
    expect(costTable(rows)).toBe(
      [
        '2026-12-01     $0.74  Cloud SQL $0.41 · Networking $0.33',
        '2026-12-02     $6.12  Compute Engine $6.12',
      ].join('\n'),
    );
    expect(costTable(costRows(''))).toMatch(/no charges yet/);
  });

  it('reads the dataset tofu declares, and only reads', () => {
    const { io, commands } = recorder();
    const logged: string[] = [];
    cost(
      { ...io, log: line => logged.push(line) },
      {
        project_id: 'r10c-demo',
        billing_dataset: 'billing_export',
      },
      3,
    );
    expect(commands.map(({ argv }) => argv.slice(0, 2).join(' '))).toEqual([
      'bq query',
    ]);
    expect(logged.join('\n')).toContain('Compute Engine $6.12');
  });
});

describe('forward', () => {
  it('holds a port-forward per service on its own port, and the broker API', () => {
    const { io, commands, files } = upInLab();
    commands.length = 0;
    forward(io, lab(io, '/repo'), '/repo', inputs.services);
    const forwards = commands
      .map(({ argv }) => argv.join(' '))
      .filter(line => line.includes('port-forward'));
    expect(forwards).toContain(
      'kubectl -n r10c port-forward svc/order-service 3105:3105',
    );
    expect(forwards).toContain(
      'kubectl -n r10c port-forward svc/rabbitmq 15672:15672',
    );
    expect(forwards).toHaveLength(inputs.services.length + 1);
    const written = files.get('/repo/infra/.overlay/lab/e2e.env') ?? '';
    expect(written).toContain("E2E_PROFILE='live'");
    expect(written).toContain("FLEET_TARGET='cluster'");
    expect(written).toContain("MAILPIT_API_URL='http://localhost:30826'");
    expect(written).not.toContain('MONGO_URI');
    // The values are in the file, never in a command line.
    const token = /CONFIG_SERVICE_TOKEN='([^']+)'/.exec(written)?.[1] ?? '';
    expect(token.length).toBeGreaterThan(8);
    expect(commands.some(({ argv }) => argv.join(' ').includes(token))).toBe(
      false,
    );
  });

  it('reaches Atlas as the operator in the cloud, and reads no mailbox there', () => {
    const { io, files } = recorder();
    forward(io, gcp(io, 2), '/repo', inputs.services);
    const written = files.get('/repo/infra/.overlay/gcp/e2e.env') ?? '';
    expect(written).toMatch(/MONGO_URI='mongodb\+srv:\/\/operator:/);
    expect(written).not.toContain('MAILPIT');
  });

  it('refuses while a dev fleet holds the ports', () => {
    const { io } = upInLab();
    const run = io.run;
    const busy: Io = {
      ...io,
      run: (argv, options) =>
        argv[0] === 'lsof' && argv.includes('-iTCP:3105')
          ? { ok: true, stdout: '4242' }
          : run(argv, options),
    };
    expect(() =>
      forward(busy, lab(busy, '/repo'), '/repo', inputs.services),
    ).toThrow(/ports taken: 3105/);
  });
});

describe('the command line', () => {
  it('takes a command and a target', () => {
    expect(parse(['up', '--target', 'lab'])).toEqual({
      command: 'up',
      target: 'lab',
      dryRun: false,
      nodes: 2,
      days: 7,
    });
    expect(parse(['cost', '--target', 'gcp', '--days', '2']).days).toBe(2);
    expect(parse(['forward', '--target', 'lab']).command).toBe('forward');
    expect(() => parse(['up'])).toThrow('--target');
    expect(() => parse(['sideways', '--target', 'lab'])).toThrow('usage');
    expect(() => parse(['cost', '--target', 'lab'])).toThrow('bills nothing');
    expect(() => parse(['cost', '--target', 'gcp', '--days', '0'])).toThrow(
      '--days',
    );
  });

  it('writes a Secret’s values encoded, never in plain text', () => {
    const text = secretDocument('fleet-token', { token: 'hunter2' });
    expect(text).toContain('token: aHVudGVyMg==');
    expect(text).not.toContain('hunter2');
  });
});
