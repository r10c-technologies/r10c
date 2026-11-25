/**
 * `pnpm run infra:up -- --target lab|gcp [--dry-run] [--nodes N]`,
 * `pnpm run infra:down -- --target lab|gcp [--dry-run]`,
 * `pnpm run infra:forward -- --target lab|gcp` and
 * `pnpm run infra:cost -- --target gcp [--days N]`.
 */
import { down, type Fleet, up } from './commands.js';
import { cost } from './cost.js';
import { type Environment, gcp, lab, readOutputs } from './environment.js';
import { forward } from './forward.js';
import { dryRunIo, type Io, realIo } from './io.js';

const COMMANDS = ['up', 'down', 'forward', 'cost'] as const;

export interface Arguments {
  readonly command: (typeof COMMANDS)[number];
  readonly target: 'lab' | 'gcp';
  readonly dryRun: boolean;
  readonly nodes: number;
  /** How many days back `cost` reads. */
  readonly days: number;
}

const USAGE =
  'usage: infra up|down|forward|cost --target lab|gcp [--dry-run] [--nodes N] [--days N]';

export const parse = (argv: readonly string[]): Arguments => {
  const [command] = argv;
  const option = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const target = option('--target');
  const known = COMMANDS.find(name => name === command);
  if (known === undefined) throw new Error(USAGE);
  if (target !== 'lab' && target !== 'gcp')
    throw new Error('--target is lab (the minikube rehearsal) or gcp');
  if (known === 'cost' && target === 'lab')
    throw new Error('the lab bills nothing: cost reads --target gcp');
  const days = Number(option('--days') ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error('--days is a whole number of days, 1 to 90');
  return {
    command: known,
    target,
    dryRun: argv.includes('--dry-run'),
    nodes: Number(option('--nodes') ?? '2'),
    days,
  };
};

/** What `--dry-run` answers for a command it does not run. */
export const dryRunAnswer = (argv: readonly string[]): string => {
  if (argv[0] === 'tofu')
    return JSON.stringify(
      Object.fromEntries(
        Object.entries({
          project_id: 'r10c-demo',
          region: 'us-central1',
          zone: 'us-central1-a',
          cluster_name: 'r10c-fleet',
          node_pool: 'fleet',
          node_pool_max: 3,
          sql_instance: 'r10c-fleet',
          sql_private_address: '10.40.0.3',
          atlas_connection_string: 'mongodb+srv://r10c-fleet.abcde.mongodb.net',
          atlas_project_id: '0123456789abcdef01234567',
          registry: 'us-central1-docker.pkg.dev/r10c-demo/r10c',
          domain: 'example.com',
          edge_address: '203.0.113.10',
          evidence_bucket: 'r10c-demo-r10c-evidence',
          secret_prefix: 'r10c-',
          billing_dataset: 'billing_export',
        }).map(([key, value]) => [key, { value }]),
      ),
    );
  if (argv.includes('jsonpath={.data.username}')) return 'ZHJ5LXJ1bg==';
  if (argv.includes('jsonpath={.data.password}')) return 'ZHJ5LXJ1bg==';
  if (argv[0] === 'gcloud' && argv[2] === 'versions' && argv[3] === 'access') {
    const secret = argv.find(arg => arg.startsWith('--secret=')) ?? '';
    if (/grafana-cloud$/.test(secret))
      return '{"endpoint":"https://otlp.example","instanceId":"1","token":"t"}';
    if (/smtp$/.test(secret))
      return '{"host":"smtp.example","port":"587","user":"u","password":"p","from":"r10c <a@example.com>","tls":true}';
    if (/posthog$/.test(secret)) return '{}';
    return 'dry-run';
  }
  // The bill (#705): a day down and a day up.
  if (argv[0] === 'bq')
    return JSON.stringify([
      { day: '2026-12-01', service: 'Cloud SQL', net: '0.41' },
      { day: '2026-12-01', service: 'Networking', net: '0.33' },
      { day: '2026-12-02', service: 'Compute Engine', net: '6.12' },
      { day: '2026-12-02', service: 'Kubernetes Engine', net: '0.00' },
    ]);
  // The census (#705): the fleet is up, and holds one order.
  if (argv.includes('gateway') && argv.includes('get'))
    return 'gateway.gateway.networking.k8s.io/r10c-edge';
  if (argv.includes('logs') && argv.includes('r10c-census'))
    return (
      {
        mongo: 'CENSUS {"order":{"product-order":1}}',
        postgres:
          'CENSUS config {"public.configuration":1}\nCENSUS workflow {"public.workflows":1}',
        redis: 'CENSUS {}',
      }[argv[argv.indexOf('-c') + 1] ?? ''] ?? ''
    );
  if (argv.includes('rabbitmqctl'))
    return '[{"name":"order-service.payment-captured","durable":true}]';
  if (argv[0] === 'curl' && argv.at(-1)?.endsWith('/api/health/live'))
    return '200';
  if (argv[0] === 'curl')
    return argv.at(-1)?.startsWith('http://')
      ? '301'
      : argv.at(-1)?.includes('/api/realtime/')
        ? '401'
        : '200';
  return '';
};

export const main = (
  argv: readonly string[],
  repoRoot: string,
  fleet: Fleet,
): void => {
  const args = parse(argv);
  const io: Io = args.dryRun
    ? dryRunIo(repoRoot, dryRunAnswer)
    : realIo(repoRoot);
  if (args.command === 'cost') {
    const outputs = readOutputs(io);
    cost(io, outputs, args.days);
    return;
  }
  const head = io
    .run(['git', 'rev-parse', '--short=12', 'HEAD'], { capture: true })
    .stdout.trim();
  const dirty =
    !args.dryRun &&
    io
      .run(['git', 'status', '--porcelain'], { capture: true })
      .stdout.trim() !== '';
  // An image is named for the commit it was built from; a dirty tree says so.
  const sha = dirty ? `${head}-dirty` : head;
  const env: Environment =
    args.target === 'gcp' ? gcp(io, args.nodes) : lab(io, repoRoot);
  if (args.command === 'up') up(io, env, { repoRoot, fleet, sha });
  else if (args.command === 'down') down(io, env, repoRoot);
  else forward(io, env, repoRoot, fleet.services);
};
