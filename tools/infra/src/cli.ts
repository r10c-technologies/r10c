/**
 * `pnpm run infra:up -- --target lab|gcp [--dry-run] [--nodes N]` and
 * `pnpm run infra:down -- --target lab|gcp [--dry-run]`.
 */
import { down, type Fleet, up } from './commands.js';
import { type Environment, gcp, lab } from './environment.js';
import { dryRunIo, type Io, realIo } from './io.js';

export interface Arguments {
  readonly command: 'up' | 'down';
  readonly target: 'lab' | 'gcp';
  readonly dryRun: boolean;
  readonly nodes: number;
}

export const parse = (argv: readonly string[]): Arguments => {
  const [command] = argv;
  const option = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const target = option('--target');
  if (command !== 'up' && command !== 'down')
    throw new Error(
      'usage: infra up|down --target lab|gcp [--dry-run] [--nodes N]',
    );
  if (target !== 'lab' && target !== 'gcp')
    throw new Error('--target is lab (the minikube rehearsal) or gcp');
  return {
    command,
    target,
    dryRun: argv.includes('--dry-run'),
    nodes: Number(option('--nodes') ?? '2'),
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
  else down(io, env);
};
