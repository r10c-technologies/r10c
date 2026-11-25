/**
 * What differs between bringing the fleet up on GCP and rehearsing it on the
 * lab's minikube (#685): where the databases are and how their users are
 * made, where the images go, where the secrets are kept, and what "start" and
 * "stop" mean. Everything else — the stages, the seed, the waits, the smoke
 * test — is one sequence in `commands.ts`.
 */
import type { Io } from './io.js';
import type { Image, Target } from './overlay.js';
import {
  MONGO_OPERATOR,
  MONGO_SERVICES,
  mongoPasswordOf,
  SQL_USERS,
  sqlPasswordOf,
} from './secrets.js';
import { fileStore, secretManager, type SecretStore } from './store.js';

export interface Environment {
  readonly target: Target;
  /** The public domain: `shop.`, `office.` and `id.` under it. */
  readonly domain: string;
  /** The edge's reserved address, where there is one. */
  readonly address: string | undefined;
  readonly store: SecretStore;
  /** Postgres, as config-service, the flow engine and Zitadel reach it. */
  readonly sqlHost: string;
  /**
   * Where order-service keeps payment receipts (#692): the bucket in the
   * cloud; in a rehearsal, a directory inside the pod, gone with it.
   */
  readonly objectStore:
    | { readonly engine: 'gcs'; readonly bucket: string }
    | { readonly engine: 'fs'; readonly directory: string };
  readonly databases: { readonly config: string; readonly workflow: string };
  /** Appended to a Postgres URL: Cloud SQL accepts encrypted connections only. */
  readonly sqlOptions: string;
  readonly mongoUri: (service: string, password: string) => string;
  /** Values a person supplies in the cloud and the lab supplies itself. */
  readonly provided: (name: string) => string | undefined;
  /** Postgres's own admin password, where the environment already has one. */
  readonly sqlAdminPassword: string | undefined;
  /** Bring up what bills by the hour, and point kubectl at the cluster. */
  readonly start: () => void;
  /** Create or update the database users, from the store's passwords. */
  readonly users: () => void;
  /** Build every image and return the overlay's renames. */
  readonly images: (projects: readonly string[], sha: string) => Image[];
  /**
   * Once the edge serves, given its in-cluster address: what a pod needs to
   * reach the public names from inside. Nothing in the cloud, where the names
   * resolve and the certificate verifies.
   */
  readonly edgeReady: (edgeAddress: string) => void;
  /** Take down what bills by the hour, keeping every disk (ADR 0083 §5). */
  readonly stop: () => void;
  readonly kubeCheck: () => void;
}

export interface TofuOutputs {
  readonly project_id: string;
  readonly region: string;
  readonly zone: string;
  readonly cluster_name: string;
  readonly node_pool: string;
  readonly node_pool_max: number;
  readonly sql_instance: string;
  readonly sql_private_address: string;
  readonly atlas_connection_string: string;
  readonly atlas_project_id: string;
  readonly registry: string;
  readonly domain: string;
  readonly edge_address: string;
  readonly evidence_bucket: string;
  readonly secret_prefix: string;
  readonly billing_dataset: string;
}

export const readOutputs = (io: Io): TofuOutputs => {
  const raw = JSON.parse(
    io.run(['tofu', '-chdir=infra/gcp', 'output', '-json'], { capture: true })
      .stdout,
  ) as Record<string, { value: unknown }>;
  return Object.fromEntries(
    Object.entries(raw).map(([key, { value }]) => [key, value]),
  ) as unknown as TofuOutputs;
};

const containers = (
  io: Io,
  projects: readonly string[],
  env: Readonly<Record<string, string>>,
) => {
  io.run(
    [
      'pnpm',
      'nx',
      'run-many',
      '-t',
      'container',
      '-p',
      projects.join(','),
      '--parallel=2',
    ],
    { env },
  );
};

export const gcp = (io: Io, nodes: number): Environment => {
  const out = readOutputs(io);
  const where = [`--project=${out.project_id}`];
  const pool = [
    `--cluster=${out.cluster_name}`,
    `--zone=${out.zone}`,
    ...where,
  ];
  const store = secretManager(io, out.project_id, out.secret_prefix);
  const password = (name: string): string => {
    const value = store.get(name);
    if (value === undefined)
      throw new Error(`the secret ${name} is empty; the secrets step mints it`);
    return value;
  };
  const host = out.atlas_connection_string.replace(/^mongodb\+srv:\/\//, '');
  return {
    target: 'gcp',
    domain: out.domain,
    address: out.edge_address,
    store,
    sqlHost: out.sql_private_address,
    objectStore: { engine: 'gcs', bucket: out.evidence_bucket },
    databases: { config: 'postgres', workflow: 'workflow' },
    sqlOptions: '?sslmode=require',
    mongoUri: (service, secret) =>
      `mongodb+srv://${service}:${encodeURIComponent(secret)}@${host}/?retryWrites=true&w=majority`,
    provided: () => undefined,
    sqlAdminPassword: undefined,
    kubeCheck: () => {
      io.run([
        'gcloud',
        'container',
        'clusters',
        'get-credentials',
        out.cluster_name,
        `--zone=${out.zone}`,
        ...where,
      ]);
    },
    start: () => {
      io.run([
        'gcloud',
        'sql',
        'instances',
        'patch',
        out.sql_instance,
        '--activation-policy=ALWAYS',
        '--quiet',
        ...where,
      ]);
      io.run([
        'gcloud',
        'container',
        'clusters',
        'resize',
        out.cluster_name,
        `--node-pool=${out.node_pool}`,
        `--num-nodes=${String(nodes)}`,
        `--zone=${out.zone}`,
        '--quiet',
        ...where,
      ]);
      io.run([
        'gcloud',
        'container',
        'node-pools',
        'update',
        out.node_pool,
        ...pool,
        '--enable-autoscaling',
        '--min-nodes=0',
        `--max-nodes=${String(out.node_pool_max)}`,
      ]);
    },
    users: () => {
      // `postgres` is Zitadel's admin connection; the two service users own
      // what they write. Zitadel creates its own user at first init.
      io.run(
        [
          'gcloud',
          'sql',
          'users',
          'set-password',
          'postgres',
          `--instance=${out.sql_instance}`,
          `--password=${password('sql-postgres-password')}`,
          ...where,
        ],
        { secretArgs: [6] },
      );
      const existing = io
        .run(
          [
            'gcloud',
            'sql',
            'users',
            'list',
            `--instance=${out.sql_instance}`,
            '--format=value(name)',
            ...where,
          ],
          { capture: true },
        )
        .stdout.split('\n');
      for (const user of SQL_USERS)
        io.run(
          [
            'gcloud',
            'sql',
            'users',
            existing.includes(user) ? 'set-password' : 'create',
            user,
            `--instance=${out.sql_instance}`,
            `--password=${password(sqlPasswordOf(user))}`,
            ...where,
          ],
          { secretArgs: [6] },
        );
      // One Atlas user per service (ADR 0083 §4). Flex offers no role scoped
      // to a database-name prefix, and the tenant plane is a database per
      // organization, so every user reads and writes any database: what a
      // user per service buys is attribution and a rotation that touches one
      // service, not isolation (ADR 0083 §4, revised). The operator's user
      // is the same role, for the live pass against a cluster (#704).
      for (const service of [...MONGO_SERVICES, MONGO_OPERATOR]) {
        const known = io.run(
          [
            'atlas',
            'dbusers',
            'describe',
            service,
            `--projectId=${out.atlas_project_id}`,
          ],
          { capture: true, allowFailure: true },
        ).ok;
        io.run(
          known
            ? [
                'atlas',
                'dbusers',
                'update',
                service,
                `--password=${password(mongoPasswordOf(service))}`,
                `--projectId=${out.atlas_project_id}`,
              ]
            : [
                'atlas',
                'dbusers',
                'create',
                'readWriteAnyDatabase',
                `--username=${service}`,
                `--password=${password(mongoPasswordOf(service))}`,
                `--projectId=${out.atlas_project_id}`,
              ],
          { capture: true, secretArgs: [known ? 4 : 5] },
        );
      }
    },
    edgeReady: () => undefined,
    images: (projects, sha) => {
      const registry = out.registry;
      io.run([
        'gcloud',
        'auth',
        'configure-docker',
        `${out.region}-docker.pkg.dev`,
        '--quiet',
      ]);
      // The nodes are x86; a Mac builds for ARM unless told otherwise.
      containers(io, projects, { DOCKER_DEFAULT_PLATFORM: 'linux/amd64' });
      return projects.map(project => {
        io.run([
          'docker',
          'tag',
          `r10c/${project}:local`,
          `${registry}/${project}:${sha}`,
        ]);
        io.run(['docker', 'push', `${registry}/${project}:${sha}`]);
        return {
          name: `r10c/${project}`,
          newName: `${registry}/${project}`,
          newTag: sha,
        };
      });
    },
    stop: () => {
      // Off first, or a pending system pod brings a node straight back.
      io.run([
        'gcloud',
        'container',
        'node-pools',
        'update',
        out.node_pool,
        ...pool,
        '--no-enable-autoscaling',
      ]);
      io.run([
        'gcloud',
        'container',
        'clusters',
        'resize',
        out.cluster_name,
        `--node-pool=${out.node_pool}`,
        '--num-nodes=0',
        `--zone=${out.zone}`,
        '--quiet',
        ...where,
      ]);
      io.run([
        'gcloud',
        'sql',
        'instances',
        'patch',
        out.sql_instance,
        '--activation-policy=NEVER',
        '--quiet',
        ...where,
      ]);
    },
  };
};

/** The lab's datastores' namespace and the names the rehearsal gives its own. */
export const LAB_NAMESPACE = 'marketplace-local-infra';
const LAB_DOMAIN = 'r10c.test';
const labHost = (service: string) =>
  `${service}.${LAB_NAMESPACE}.svc.cluster.local`;
export const LAB_DATABASES = {
  config: 'config_rehearsal',
  workflow: 'workflow_rehearsal',
} as const;

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const lab = (io: Io, repoRoot: string): Environment => {
  const store = fileStore(io, `${repoRoot}/infra/.overlay/lab/secrets.json`);
  const password = (name: string) => store.get(name) ?? '';
  const psql = (sql: string, database = 'postgres') =>
    io.run(
      [
        'kubectl',
        '-n',
        LAB_NAMESPACE,
        'exec',
        '-i',
        'deploy/postgres',
        '--',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        database,
        '-q',
      ],
      { input: sql, capture: true },
    );
  const deployments = (namespace: string, replicas: number) => {
    io.run([
      'kubectl',
      '-n',
      namespace,
      'scale',
      'deployment',
      '--all',
      `--replicas=${String(replicas)}`,
    ]);
  };
  return {
    target: 'lab',
    domain: LAB_DOMAIN,
    address: undefined,
    store,
    sqlHost: labHost('postgres'),
    objectStore: { engine: 'fs', directory: '/tmp/payment-evidence' },
    databases: LAB_DATABASES,
    sqlOptions: '',
    mongoUri: (service, secret) =>
      `mongodb://${service}:${encodeURIComponent(secret)}@${labHost('mongodb')}:27017/?directConnection=true&authSource=admin`,
    provided: name =>
      ({
        // Telemetry goes to the lab's own Grafana, which ignores the
        // credential the gateway presents.
        'grafana-cloud': JSON.stringify({
          endpoint: `http://${labHost('otel-lgtm')}:4318`,
          instanceId: 'lab',
          token: 'lab',
        }),
        posthog: '{}',
        smtp: JSON.stringify({
          host: labHost('mailpit'),
          port: '1025',
          user: '',
          password: '',
          from: 'r10c <pedidos@r10c.test>',
          tls: false,
        }),
      })[name],
    // The lab's Postgres admin, as infra/local/postgres/.env sets it.
    sqlAdminPassword: 'postgres',
    kubeCheck: () => {
      const context = io
        .run(['kubectl', 'config', 'current-context'], { capture: true })
        .stdout.trim();
      if (context !== 'minikube' && context !== '')
        throw new Error(
          `kubectl points at "${context}"; the rehearsal runs on minikube only`,
        );
    },
    start: () => {
      // The lab's own ladder: its Postgres, Mongo and Mailpit are the
      // rehearsal's Cloud SQL, Atlas and mail provider.
      io.run(['bash', 'infra/local/ensure.sh']);
    },
    users: () => {
      for (const user of SQL_USERS) {
        const secret = quoted(password(sqlPasswordOf(user)));
        psql(
          `DO $$ BEGIN
             IF EXISTS (SELECT FROM pg_roles WHERE rolname = '${user}')
             THEN ALTER ROLE "${user}" LOGIN PASSWORD ${secret};
             ELSE CREATE ROLE "${user}" LOGIN PASSWORD ${secret};
             END IF;
           END $$;`,
        );
      }
      for (const [user, database] of [
        ['config-service', LAB_DATABASES.config],
        ['transaction-service', LAB_DATABASES.workflow],
      ] as const) {
        const exists = psql(
          `SELECT 1 FROM pg_database WHERE datname = '${database}'`,
        );
        if (!/1/.test(exists.stdout))
          psql(`CREATE DATABASE ${database} OWNER "${user}"`);
      }
      const mongo = MONGO_SERVICES.map(service => {
        const secret = JSON.stringify(password(mongoPasswordOf(service)));
        return `if (db.getUser('${service}')) db.updateUser('${service}', { pwd: ${secret} }); else db.createUser({ user: '${service}', pwd: ${secret}, roles: [{ role: 'readWriteAnyDatabase', db: 'admin' }] });`;
      }).join('\n');
      io.run(
        [
          'kubectl',
          '-n',
          LAB_NAMESPACE,
          'exec',
          '-i',
          'deploy/mongodb',
          '--',
          'mongosh',
          '--quiet',
          '-u',
          'admin',
          '-p',
          'password',
          '--authenticationDatabase',
          'admin',
          'admin',
        ],
        { input: mongo, capture: true },
      );
    },
    // No DNS answers for the lab's domain, so auth-service is told where
    // `id.` is — the edge's Service — and trusts the self-signed certificate
    // the lab overlay mounts. The patch rolls it, which is also what makes it
    // read the certificate issued since it started.
    edgeReady: edgeAddress => {
      io.run(
        [
          'kubectl',
          '-n',
          'r10c',
          'patch',
          'deployment',
          'auth-service',
          '--type=json',
          '-p',
          JSON.stringify([
            {
              op: 'add',
              path: '/spec/template/spec/hostAliases',
              value: [{ ip: edgeAddress, hostnames: [`id.${LAB_DOMAIN}`] }],
            },
          ]),
        ],
        { capture: true },
      );
    },
    images: (projects, sha) => {
      // Built straight into minikube's Docker, where `IfNotPresent` finds
      // them, and tagged once more per up: an unchanged `:local` would leave
      // every running pod on the image it started with.
      const env = Object.fromEntries(
        io
          .run(['minikube', 'docker-env', '--shell=bash'], { capture: true })
          .stdout.split('\n')
          .map(line => /^export (\w+)="(.*)"$/.exec(line))
          .filter(match => match !== null)
          .map(match => [match[1] ?? '', match[2] ?? '']),
      );
      containers(io, projects, env);
      const tag = `${sha}-${Date.now().toString(36)}`;
      return projects.map(project => {
        io.run(
          ['docker', 'tag', `r10c/${project}:local`, `r10c/${project}:${tag}`],
          {
            env,
          },
        );
        return {
          name: `r10c/${project}`,
          newName: `r10c/${project}`,
          newTag: tag,
        };
      });
    },
    stop: () => {
      // One node that also runs the lab's datastores cannot be scaled to
      // zero, so down stops every pod instead, operators first so the broker
      // stays down; the claims keep their volumes either way.
      deployments('rabbitmq-system', 0);
      deployments('r10c', 0);
      io.run([
        'kubectl',
        '-n',
        'r10c',
        'scale',
        'statefulset',
        '--all',
        '--replicas=0',
      ]);
    },
  };
};
