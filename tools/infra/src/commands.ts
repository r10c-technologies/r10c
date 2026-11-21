/**
 * One command up, one command down (ADR 0083 §5, #685).
 *
 * **Up is idempotent**: every step converges on a state rather than assuming
 * one, so it is also how a half-finished up is resumed and how a new image is
 * rolled out. **Down never deletes data**: it removes what bills by the hour
 * and holds nothing — the nodes, Cloud SQL's compute, the edge's load
 * balancer — and its one `delete` is the Gateway, which the next up applies
 * again. The spec fails on any other destructive verb on the way down.
 */
import type { Environment } from './environment.js';
import type { Io } from './io.js';
import {
  type Document,
  documents,
  NAMESPACE,
  stages,
  stream,
  substitute,
} from './manifests.js';
import { overlayKustomization } from './overlay.js';
import {
  GENERATED_SECRETS,
  type GrafanaCloud,
  mint,
  MONGO_SERVICES,
  mongoPasswordOf,
  type PostHog,
  PROVIDED_SECRETS,
  type Smtp,
  sqlPasswordOf,
} from './secrets.js';

export interface Fleet {
  /** Every project that builds an image: the services and the Next apps. */
  readonly projects: readonly string[];
  /** Every name the fleet's generator renders (`tools/cluster`). */
  readonly names: ReadonlySet<string>;
  /** The fleet's `Deployment`s, waited on one by one. */
  readonly deployments: readonly string[];
}

export interface Run {
  readonly repoRoot: string;
  readonly fleet: Fleet;
  readonly sha: string;
}

const GATEWAY = 'r10c-edge';
const EDGE_SELECTOR = `gateway.envoyproxy.io/owning-gateway-name=${GATEWAY}`;
const OPERATOR_NAMESPACES = [
  'cert-manager',
  'envoy-gateway-system',
  'rabbitmq-system',
] as const;

export const hosts = (domain: string) => ({
  storefront: `shop.${domain}`,
  backOffice: `office.${domain}`,
  identity: `id.${domain}`,
});

const base64 = (value: string) => Buffer.from(value, 'utf8').toString('base64');

/** A Secret as a document, so its values travel on stdin rather than in argv. */
export const secretDocument = (
  name: string,
  data: Readonly<Record<string, string>>,
): string =>
  [
    'apiVersion: v1',
    'kind: Secret',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${NAMESPACE}`,
    'type: Opaque',
    'data:',
    ...Object.entries(data).map(([key, value]) => `  ${key}: ${base64(value)}`),
    '',
  ].join('\n');

export const configMapDocument = (
  name: string,
  data: Readonly<Record<string, string>>,
): string =>
  [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    `  namespace: ${NAMESPACE}`,
    'data:',
    ...Object.entries(data).map(
      ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
    ),
    '',
  ].join('\n');

const step = (io: Io, title: string) => {
  io.log(`\n▸ ${title}`);
};

/**
 * Apply, retried for a minute. An operator's Deployment turns Available a
 * moment before its admission webhook answers, and a fresh CRD before its
 * kind is served; both refuse an apply that would succeed seconds later. A
 * failure that outlasts the window is reported as it is.
 */
const apply = (io: Io, text: string) => {
  if (text.trim() === '') return;
  const argv = [
    'kubectl',
    'apply',
    '--server-side',
    '--force-conflicts',
    '-f',
    '-',
  ];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (io.run(argv, { input: text, capture: true, allowFailure: true }).ok)
      return;
    io.log('  (not admitted yet; again in 5 s)');
    io.sleep(5000);
  }
  io.run(argv, { input: text, capture: true });
};

const kubectl = (io: Io, ...args: string[]) =>
  io.run(['kubectl', ...args], { capture: true });

/** Every generated secret exists, every provided one is present, and nothing is rotated. */
const ensureSecrets = (io: Io, env: Environment) => {
  for (const name of GENERATED_SECRETS)
    if (env.store.get(name) === undefined) {
      io.log(`  minting ${name}`);
      env.store.put(name, mint(name));
    }
  if (env.sqlAdminPassword !== undefined)
    env.store.put('sql-postgres-password', env.sqlAdminPassword);
  const missing: string[] = [];
  for (const name of PROVIDED_SECRETS) {
    if (env.store.get(name) !== undefined) continue;
    const fallback = env.provided(name);
    if (fallback !== undefined) env.store.put(name, fallback);
    else if (name === 'posthog') env.store.put(name, '{}');
    else missing.push(name);
  }
  if (missing.length > 0)
    throw new Error(
      `add these secrets before the first up (docs/DEVELOPING.md → "The cloud environment"): ${missing.join(', ')}`,
    );
};

const value = (env: Environment, name: string): string => {
  const found = env.store.get(name);
  if (found === undefined) throw new Error(`the secret ${name} is empty`);
  return found;
};

const json = <T>(env: Environment, name: string): T =>
  JSON.parse(value(env, name)) as T;

const postgresUrl = (
  env: Environment,
  user: string,
  database: string,
): string =>
  `postgres://${user}:${encodeURIComponent(value(env, sqlPasswordOf(user)))}@${env.sqlHost}:5432/${database}${env.sqlOptions}`;

/** What the platform reads before the identity provider exists. */
const platformSecrets = (env: Environment): string => {
  const { storefront, backOffice, identity } = hosts(env.domain);
  const grafana = json<GrafanaCloud>(env, 'grafana-cloud');
  return [
    configMapDocument('cloud-endpoints', {
      SQL_PRIVATE_ADDRESS: env.sqlHost,
      IDENTITY_DOMAIN: identity,
      IDENTITY_HOST_HEADER: `Host:${identity}`,
      STOREFRONT_ORIGIN: `https://${storefront}`,
      BACK_OFFICE_ORIGIN: `https://${backOffice}`,
    }),
    secretDocument('fleet-token', { token: value(env, 'fleet-token') }),
    secretDocument('config-service-database', {
      url: postgresUrl(env, 'config-service', env.databases.config),
    }),
    secretDocument('redis-secret', {
      REDIS_PASSWORD: value(env, 'redis-password'),
    }),
    secretDocument('zitadel-secret', {
      ZITADEL_MASTERKEY: value(env, 'zitadel-masterkey'),
      ZITADEL_DATABASE_POSTGRES_ADMIN_PASSWORD: value(
        env,
        'sql-postgres-password',
      ),
      ZITADEL_DATABASE_POSTGRES_USER_PASSWORD: value(
        env,
        'sql-zitadel-password',
      ),
      ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD: value(
        env,
        'zitadel-admin-password',
      ),
    }),
    secretDocument('grafana-cloud', {
      GRAFANA_CLOUD_OTLP_ENDPOINT: grafana.endpoint,
      GRAFANA_CLOUD_INSTANCE_ID: grafana.instanceId,
      GRAFANA_CLOUD_TOKEN: grafana.token,
    }),
    secretDocument('storefront-tokens', {
      coordinator: value(env, 'flow-crossing-token'),
      lookup: value(env, 'storefront-lookup-token'),
    }),
    secretDocument('posthog', {
      POSTHOG_KEY: json<PostHog>(env, 'posthog').key ?? '',
      POSTHOG_HOST: json<PostHog>(env, 'posthog').host ?? '',
    }),
  ].join('---\n');
};

const decoded = (io: Io, secret: string, key: string): string =>
  Buffer.from(
    kubectl(
      io,
      '-n',
      NAMESPACE,
      'get',
      'secret',
      secret,
      '-o',
      `jsonpath={.data.${key}}`,
    ).stdout,
    'base64',
  ).toString('utf8');

/**
 * Give the cluster's Zitadel what the lab ladder's L7 rung gives the lab's
 * (`tools/zitadel-seed.mjs`, the same script), through a port-forward and
 * under the public host the instance answers for. What it mints is stored, so
 * the next up hands the fleet the same values.
 */
const seedIdentity = (io: Io, env: Environment, run: Run) => {
  const { backOffice, identity } = hosts(env.domain);
  const dir = `${run.repoRoot}/infra/.overlay/${env.target}`;
  const patFile = `${dir}/seed.pat`;
  const generated = `${dir}/zitadel.env`;
  const pat = (file: string) =>
    kubectl(
      io,
      '-n',
      NAMESPACE,
      'exec',
      'deploy/zitadel',
      '-c',
      'pat-reader',
      '--',
      'cat',
      `/machinekey/${file}`,
    ).stdout.trim();
  io.write(patFile, pat('seed.pat'));
  // The action's signing key is served once, at creation; the seed carries a
  // known one forward from this file rather than minting a second target.
  const known = env.store.get('zitadel-action-signing-key');
  io.write(
    generated,
    known === undefined ? '' : `ZITADEL_ACTION_SIGNING_KEY=${known}\n`,
  );
  const smtp = json<Smtp>(env, 'smtp');
  const callback = (path: string) =>
    `http://auth-service.${NAMESPACE}.svc.cluster.local:3102/api/auth/${path}`;
  const forward = io.background([
    'kubectl',
    '-n',
    NAMESPACE,
    'port-forward',
    'svc/zitadel',
    '18080:8080',
  ]);
  try {
    io.sleep(3000);
    io.run(['node', 'tools/zitadel-seed.mjs'], {
      env: {
        ZITADEL_ISSUER: 'http://127.0.0.1:18080',
        ZITADEL_HOST_HEADER: identity,
        ZITADEL_PAT_FILE: patFile,
        ZITADEL_GENERATED_ENV: generated,
        ZITADEL_REDIRECT_URIS: `https://${backOffice}/api/auth/callback`,
        ZITADEL_POST_LOGOUT_URIS: `https://${backOffice}/`,
        ZITADEL_LOGIN_BASE_URI: `https://${identity}/ui/v2/login/`,
        ZITADEL_BACKCHANNEL_LOGOUT_URI: callback('backchannel-logout'),
        ZITADEL_PROVIDER_EVENTS_URI: callback('provider-events'),
        ZITADEL_SMTP_HOST: `${smtp.host}:${smtp.port}`,
        ZITADEL_SMTP_USER: smtp.user,
        ZITADEL_SMTP_PASSWORD: smtp.password,
        ZITADEL_SMTP_TLS: String(smtp.tls),
        ZITADEL_SMTP_SENDER: smtp.from.replace(/^.*<(.+)>.*$/, '$1'),
      },
    });
  } finally {
    forward.stop();
  }
  const minted = Object.fromEntries(
    (io.read(generated) ?? '')
      .split('\n')
      .map(line => /^([A-Z_]+)=(.*)$/.exec(line))
      .filter(match => match !== null)
      .map(match => [match[1] ?? '', match[2] ?? '']),
  );
  const keep = (name: string, found: string | undefined) => {
    if (found !== undefined && found !== '' && env.store.get(name) !== found)
      env.store.put(name, found);
  };
  keep('zitadel-client-id', minted['ZITADEL_CLIENT_ID']);
  keep('zitadel-pat', minted['ZITADEL_PAT']);
  keep('zitadel-action-signing-key', minted['ZITADEL_ACTION_SIGNING_KEY']);
  keep('zitadel-login-pat', pat('login-client.pat'));
};

/** The cluster seed's inputs (apps/config-service/src/cluster-seed.ts). */
const seedInputs = (io: Io, env: Environment): string => {
  const { storefront, backOffice, identity } = hosts(env.domain);
  const smtp = json<Smtp>(env, 'smtp');
  const rabbit = `amqp://${encodeURIComponent(
    decoded(io, 'rabbitmq-default-user', 'username'),
  )}:${encodeURIComponent(decoded(io, 'rabbitmq-default-user', 'password'))}@rabbitmq.${NAMESPACE}.svc.cluster.local:5672`;
  return JSON.stringify({
    origins: {
      storefront: `https://${storefront}`,
      backOffice: `https://${backOffice}`,
      identity: `https://${identity}`,
    },
    smtp: {
      host: smtp.host,
      port: smtp.port,
      from: smtp.from,
      user: smtp.user,
      password: smtp.password,
      tls: smtp.tls,
    },
    objectStore: env.objectStore,
    zitadelClientId: value(env, 'zitadel-client-id'),
    secrets: {
      'jwt-private-key': value(env, 'jwt-private-key'),
      'flow-crossing-token': value(env, 'flow-crossing-token'),
      'stock-crossing-token': value(env, 'stock-crossing-token'),
      'order-crossing-token': value(env, 'order-crossing-token'),
      'payment-crossing-token': value(env, 'payment-crossing-token'),
      'fulfilment-crossing-token': value(env, 'fulfilment-crossing-token'),
      'storefront-lookup-token': value(env, 'storefront-lookup-token'),
      'rabbitmq-uri': rabbit,
      'redis-uri': `redis://:${encodeURIComponent(value(env, 'redis-password'))}@redis.${NAMESPACE}.svc.cluster.local:6379`,
      'workflow-database-url': postgresUrl(
        env,
        'transaction-service',
        env.databases.workflow,
      ),
      'zitadel-pat': value(env, 'zitadel-pat'),
      'zitadel-action-signing-key': value(env, 'zitadel-action-signing-key'),
      ...Object.fromEntries(
        MONGO_SERVICES.map(service => [
          `mongo-uri-${service}`,
          env.mongoUri(service, value(env, mongoPasswordOf(service))),
        ]),
      ),
    },
  });
};

const rollout = (io: Io, kind: string, name: string, minutes = 10) => {
  io.run([
    'kubectl',
    '-n',
    NAMESPACE,
    'rollout',
    'status',
    `${kind}/${name}`,
    `--timeout=${String(minutes)}m`,
  ]);
};

/** What the browser would see, through the edge and nothing else. */
export const smoke = (io: Io, env: Environment) => {
  const { storefront, backOffice, identity } = hosts(env.domain);
  let target = env.address;
  let forward = { stop: () => undefined as void };
  if (target === undefined) {
    const service = kubectl(
      io,
      '-n',
      'envoy-gateway-system',
      'get',
      'service',
      '-l',
      EDGE_SELECTOR,
      '-o',
      'name',
    ).stdout.trim();
    forward = io.background([
      'kubectl',
      '-n',
      'envoy-gateway-system',
      'port-forward',
      service,
      '18443:443',
      '18081:80',
    ]);
    io.sleep(3000);
    target = '127.0.0.1';
  }
  const local = env.address === undefined;
  const status = (url: string, port: number) =>
    io.run(
      [
        'curl',
        // The lab's certificate is self-signed; a cloud one must verify.
        local ? '-sk' : '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '--max-time',
        '20',
        '--connect-to',
        `::${target ?? ''}:${String(local ? (port === 443 ? 18443 : 18081) : port)}`,
        url,
      ],
      { capture: true, allowFailure: true },
    ).stdout;
  const checks: [string, number, RegExp][] = [
    // `/` redirects to the default locale, which is what renders.
    [`https://${storefront}/es`, 443, /^200$/],
    [`https://${backOffice}/`, 443, /^(200|30[27])$/],
    [`https://${identity}/.well-known/openid-configuration`, 443, /^200$/],
    [`https://${identity}/ui/v2/login/healthy`, 443, /^200$/],
    // No session: realtime-service answers 401 before the stream opens,
    // which proves the route reaches it rather than Next.
    [
      `https://${storefront}/api/realtime/stream?topic=entity:order`,
      443,
      /^401$/,
    ],
    [`https://${storefront}/api/analytics`, 443, /^200$/],
    [`http://${storefront}/`, 80, /^301$/],
  ];
  const failed: string[] = [];
  try {
    for (const [url, port, expected] of checks) {
      const answer = status(url, port);
      io.log(`  ${answer.padEnd(3)} ${url}`);
      if (!expected.test(answer)) failed.push(`${url} answered ${answer}`);
    }
  } finally {
    forward.stop();
  }
  if (failed.length > 0)
    throw new Error(`smoke test failed:\n  ${failed.join('\n  ')}`);
};

export const up = (io: Io, env: Environment, run: Run) => {
  step(io, `${env.target}: what bills by the hour`);
  env.start();
  env.kubeCheck();

  step(io, 'secrets');
  ensureSecrets(io, env);

  step(io, 'database users');
  env.users();

  step(io, 'images');
  const images = env.images(run.fleet.projects, run.sha);

  step(io, 'render');
  const overlay = `${run.repoRoot}/infra/.overlay/${env.target}`;
  io.write(
    `${overlay}/kustomization.yaml`,
    overlayKustomization(env.target, '../../cluster', images),
  );
  const rendered = substitute(kubectl(io, 'kustomize', overlay).stdout, {
    domain: env.domain,
    address: env.address,
  });
  const parts = stages(documents(rendered), run.fleet.names);
  const applyAll = (docs: readonly Document[]) => {
    apply(io, stream(docs));
  };

  step(io, 'definitions');
  applyAll(parts.definitions);
  kubectl(
    io,
    'wait',
    '--for=condition=Established',
    'crd',
    '--all',
    '--timeout=3m',
  );

  step(io, 'operators');
  // Each operator back at its declared size, after a down that stopped it.
  applyAll(parts.operators);
  // cert-manager first: its webhook admits the certificate the RabbitMQ
  // operator's own webhook is served with, and that operator cannot start
  // without it.
  kubectl(
    io,
    '-n',
    'cert-manager',
    'wait',
    '--for=condition=Available',
    'deployment',
    '--all',
    '--timeout=5m',
  );
  applyAll(parts.issued);
  for (const namespace of OPERATOR_NAMESPACES)
    kubectl(
      io,
      '-n',
      namespace,
      'wait',
      '--for=condition=Available',
      'deployment',
      '--all',
      '--timeout=5m',
    );

  step(io, 'platform');
  apply(io, platformSecrets(env));
  applyAll(parts.platform);
  rollout(io, 'statefulset', 'redis');
  kubectl(
    io,
    '-n',
    NAMESPACE,
    'wait',
    '--for=condition=AllReplicasReady',
    'rabbitmqcluster/rabbitmq',
    '--timeout=10m',
  );
  rollout(io, 'deployment', 'zitadel', 15);
  rollout(io, 'deployment', 'otel-gateway');

  step(io, 'identity');
  // Zitadel resolves a callback's address when it is registered, so the
  // fleet's Services exist before the seed names them.
  applyAll(parts.fleetServices);
  seedIdentity(io, env, run);
  apply(
    io,
    secretDocument('zitadel-login-secret', {
      'login-client.pat': value(env, 'zitadel-login-pat'),
    }),
  );
  kubectl(
    io,
    '-n',
    NAMESPACE,
    'rollout',
    'restart',
    'deployment/zitadel-login',
  );
  rollout(io, 'deployment', 'zitadel-login');

  step(io, 'fleet');
  apply(
    io,
    secretDocument('config-seed', { 'seed.json': seedInputs(io, env) }),
  );
  applyAll(parts.fleet);

  // The edge before the fleet's readiness: auth-service reaches Zitadel at
  // its public issuer, through the edge, so it cannot be ready before the
  // edge serves `id.` with a certificate.
  step(io, 'edge');
  applyAll(parts.edge);
  kubectl(
    io,
    '-n',
    NAMESPACE,
    'wait',
    '--for=condition=Ready',
    'certificate/edge-tls',
    '--timeout=10m',
  );
  kubectl(
    io,
    '-n',
    'envoy-gateway-system',
    'wait',
    '--for=condition=Available',
    'deployment',
    '-l',
    EDGE_SELECTOR,
    '--timeout=5m',
  );
  env.edgeReady(
    kubectl(
      io,
      '-n',
      'envoy-gateway-system',
      'get',
      'service',
      '-l',
      EDGE_SELECTOR,
      '-o',
      'jsonpath={.items[0].spec.clusterIP}',
    ).stdout.trim(),
  );

  step(io, 'fleet readiness');
  for (const name of run.fleet.deployments) rollout(io, 'deployment', name, 15);

  step(io, 'smoke test');
  smoke(io, env);
  io.log(`\n✓ up: https://${hosts(env.domain).storefront}`);
};

export const down = (io: Io, env: Environment) => {
  env.kubeCheck();
  step(io, 'the edge’s load balancer');
  // The one delete on the way down: the Gateway holds no data, and with it
  // goes the forwarding rule that bills while idle. The address is
  // reserved in infra/gcp, so the next up takes the same one back.
  kubectl(
    io,
    '-n',
    NAMESPACE,
    'delete',
    'gateway',
    GATEWAY,
    '--ignore-not-found',
  );
  step(io, `${env.target}: what bills by the hour`);
  env.stop();
  step(io, 'what is kept');
  io.run(['kubectl', '-n', NAMESPACE, 'get', 'persistentvolumeclaims']);
  io.log('\n✓ down: every disk, database and secret is kept.');
};
