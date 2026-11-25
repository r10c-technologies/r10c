/**
 * The live pass against a cluster (#704):
 * `pnpm run infra:forward -- --target lab|gcp`, then, in another shell,
 * `set -a; . infra/.overlay/<target>/e2e.env; set +a; pnpm nx e2e fleet-e2e`.
 *
 * The fleet's services are ClusterIP and the edge routes none of them, so
 * this holds one `kubectl port-forward` per service on the service's own
 * canonical port — the port `apps/fleet-e2e` already defaults to — plus the
 * broker's management API, until Ctrl-C. What the pass needs besides the
 * ports goes into an env file beside the target's secrets, never onto the
 * terminal: the fleet token, the broker's credentials and, in the cloud, the
 * `operator` user's Mongo URI (Atlas admits it only from `operator_cidrs`).
 *
 * Two things the lab's own ports already serve, the cluster rehearsal shares:
 * its Mongo and its Mailpit are the lab's. In the cloud there is no mailbox
 * to read, so the pass's mail-reading tests report skipped there and a real
 * inbox is the apply-day check.
 */
import type { Environment } from './environment.js';
import type { Io } from './io.js';
import { NAMESPACE } from './manifests.js';
import { MONGO_OPERATOR, mongoPasswordOf } from './secrets.js';

export interface ForwardedService {
  readonly project: string;
  readonly port: number;
}

/** The broker's management API, on its own port rather than the lab's 31672. */
export const BROKER_API_PORT = 15672;

/** Where `forward` leaves what the pass reads. */
export const e2eEnvPath = (repoRoot: string, env: Environment) =>
  `${repoRoot}/infra/.overlay/${env.target}/e2e.env`;

const fromSecret = (io: Io, secret: string, key: string) =>
  Buffer.from(
    io.run(
      [
        'kubectl',
        '-n',
        NAMESPACE,
        'get',
        'secret',
        secret,
        '-o',
        `jsonpath={.data.${key}}`,
      ],
      { capture: true },
    ).stdout,
    'base64',
  ).toString('utf8');

const stored = (env: Environment, name: string) => {
  const value = env.store.get(name);
  if (value === undefined)
    throw new Error(`the secret ${name} is empty; run the up command first`);
  return value;
};

/** What the pass reads, as `KEY=value` lines. */
export const e2eEnv = (
  io: Io,
  env: Environment,
): Readonly<Record<string, string>> => ({
  E2E_PROFILE: 'live',
  FLEET_TARGET: 'cluster',
  CONFIG_SERVICE_TOKEN: stored(env, 'fleet-token'),
  // The stream, straight from realtime-service: the edge's TLS listeners
  // answer only their public names, and the up command's smoke test is what
  // proves the edge routes the stream at all.
  EDGE_URL: 'http://localhost:3191',
  RABBITMQ_API_URL: `http://localhost:${String(BROKER_API_PORT)}`,
  RABBITMQ_API_CREDENTIALS: `${fromSecret(io, 'rabbitmq-default-user', 'username')}:${fromSecret(io, 'rabbitmq-default-user', 'password')}`,
  ...(env.target === 'lab'
    ? { MAILPIT_API_URL: 'http://localhost:30826' }
    : {
        MONGO_URI: env.mongoUri(
          MONGO_OPERATOR,
          stored(env, mongoPasswordOf(MONGO_OPERATOR)),
        ),
      }),
});

/** A value quoted for `sh`, so a password with a `$` reads back as written. */
const quoted = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const forward = (
  io: Io,
  env: Environment,
  repoRoot: string,
  services: readonly ForwardedService[],
): void => {
  env.kubeCheck();
  const targets = [
    ...services.map(({ project, port }) => ({
      name: `svc/${project}`,
      port,
      remote: port,
    })),
    { name: 'svc/rabbitmq', port: BROKER_API_PORT, remote: 15672 },
  ];
  // A dev fleet on the same ports would answer instead of the cluster, and a
  // pass would measure the wrong thing while reporting green.
  const taken = targets.filter(
    ({ port }) =>
      io
        .run(['lsof', '-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'], {
          capture: true,
          allowFailure: true,
        })
        .stdout.trim() !== '',
  );
  if (taken.length > 0)
    throw new Error(
      `ports taken: ${taken.map(({ port }) => String(port)).join(', ')} — stop the dev fleet first (pnpm run dev-ports:free)`,
    );
  const values = e2eEnv(io, env);
  io.write(
    e2eEnvPath(repoRoot, env),
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${quoted(value)}`)
      .join('\n')}\n`,
  );
  for (const { name, port, remote } of targets)
    io.background([
      'kubectl',
      '-n',
      NAMESPACE,
      'port-forward',
      name,
      `${String(port)}:${String(remote)}`,
    ]);
  io.sleep(3000);
  const silent = services.filter(
    ({ port }) =>
      io.run(
        [
          'curl',
          '-s',
          '-o',
          '/dev/null',
          '-w',
          '%{http_code}',
          '--max-time',
          '5',
          `http://localhost:${String(port)}/api/health/live`,
        ],
        { capture: true, allowFailure: true },
      ).stdout !== '200',
  );
  if (silent.length > 0)
    io.log(
      `  not answering yet: ${silent.map(({ project }) => project).join(', ')}`,
    );
  io.log(
    [
      '',
      `✓ forwarding ${String(targets.length)} ports from ${env.target}; Ctrl-C ends them. In another shell:`,
      `  set -a; . ${e2eEnvPath('.', env).slice(2)}; set +a`,
      '  pnpm nx e2e fleet-e2e',
    ].join('\n'),
  );
};
