import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { ConfigurationRow } from '@r10c/shells-effect-config';

/**
 * The cluster's seed (#683, ADR 0083): the lab's rows, rewritten.
 *
 * The lab seed in `db.ts` stays the one list of every row the fleet reads. A
 * cluster differs from it in two ways only — where things are, and what the
 * secrets are — so this module rewrites those and nothing else, and a row
 * added to the lab seed reaches the cluster without anyone remembering to.
 *
 * - **Where things are** is mechanical: a service's `localhost:31xx` becomes its
 *   in-cluster name, the edge's `300N` origins become the public hostnames, and
 *   every service sends telemetry to the agent on its node.
 * - **What the secrets are** arrives in one JSON document, `CONFIG_SEED_FILE`,
 *   mounted from the `config-seed` Secret the up command writes from Secret
 *   Manager (`tools/infra`). Nothing secret is in the repository and nothing
 *   here invents one.
 *
 * ⚠️ **A lab value never reaches a cluster.** After the rewrite, a row still
 * pointing at `localhost`, holding a `dev-…-change-me` token or the committed
 * development key fails the boot, naming the row — so a lab row this module
 * does not know how to rewrite is a failed deploy, never a cluster quietly
 * signing tokens with a key anyone can read on GitHub.
 */

/** Every secret the cluster seed is handed, by its Secret Manager name. */
export const CLUSTER_SECRETS = [
  'jwt-private-key',
  'flow-crossing-token',
  'stock-crossing-token',
  'order-crossing-token',
  'payment-crossing-token',
  'fulfilment-crossing-token',
  'storefront-lookup-token',
  'rabbitmq-uri',
  'redis-uri',
  'workflow-database-url',
  'zitadel-pat',
  'zitadel-action-signing-key',
] as const;

export type ClusterSecret = (typeof CLUSTER_SECRETS)[number];

/** A Mongo-backed service's own connection string: one database user each (ADR 0083 §4). */
export const mongoSecretOf = (service: string): string =>
  `mongo-uri-${service}`;

/** What the up command hands config-service, as `CONFIG_SEED_FILE`. */
export interface ClusterSeedInputs {
  /** The public origins, `https://<host>` with no trailing slash. */
  readonly origins: {
    readonly storefront: string;
    readonly backOffice: string;
    readonly identity: string;
  };
  readonly smtp: {
    readonly host: string;
    readonly port: string;
    readonly from: string;
  };
  /** The OIDC app's client id: minted by the instance, public. */
  readonly zitadelClientId: string;
  /** Every {@link ClusterSecret}, plus a {@link mongoSecretOf} per Mongo service. */
  readonly secrets: Readonly<Record<string, string>>;
}

/**
 * Where each service listens, by its lab port. The in-cluster `Service` names
 * are the projects' own (`tools/cluster`), so `localhost:3105` is
 * `order-service:3105`; a port missing here is a lab URL nobody can rewrite,
 * and the lab-value check refuses it.
 */
const SERVICE_PORTS: Readonly<Record<string, string>> = {
  '3100': 'marketplace-service',
  '3101': 'marketplace-admin-service',
  '3102': 'auth-service',
  '3103': 'transaction-service',
  '3105': 'order-service',
  '3106': 'payment-service',
  '3107': 'settlement-service',
  '3108': 'stock-service',
  '3109': 'sales-service',
  '3110': 'fulfilment-service',
  '3190': 'config-service',
  '3191': 'realtime-service',
};

/**
 * The lab's crossing tokens, each standing for one secret. Rewriting by value
 * rather than by row is what keeps the two halves of a pair equal: the flow
 * token is the coordinator's `service.token` and three slices'
 * `transaction.crossingToken`, and all four become the same secret.
 */
const LAB_TOKENS: Readonly<Record<string, ClusterSecret>> = {
  'dev-flow-crossing-token-change-me': 'flow-crossing-token',
  'dev-stock-crossing-token-change-me': 'stock-crossing-token',
  'dev-order-crossing-token-change-me': 'order-crossing-token',
  'dev-payment-crossing-token-change-me': 'payment-crossing-token',
  'dev-fulfilment-crossing-token-change-me': 'fulfilment-crossing-token',
  'dev-storefront-lookup-token-change-me': 'storefront-lookup-token',
};

/** Where every pod sends telemetry: the agent on its own node (infra/cluster/platform/otel.yaml). */
export const CLUSTER_OTEL_ENDPOINT = 'http://otel-agent:4318';

/**
 * How often each service exports its metrics in the cluster. Grafana Cloud's
 * free tier counts active series, not samples, so the interval is not what
 * keeps the fleet under it; what it sets is data points per minute, which the
 * tier also caps (#684 — the arithmetic is in infra/cluster/README.md).
 */
export const CLUSTER_METRIC_INTERVAL_MS = '60000';

/**
 * The cluster logs at `info`. Logs are billed by the gigabyte, and `debug` is
 * the lab's level for reading a flow step by step.
 */
export const CLUSTER_LOG_LEVEL = 'info';

const LAB_VALUE =
  /localhost|127\.0\.0\.1|change-me|\bdev-|admin:password|:localdev@|postgres:postgres@/;

/** The key id travels in every token header: derived from the key, so a rotation renames it. */
const keyIdOf = (publicKeyPem: string): string =>
  `cluster-${createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 12)}`;

const publicKeyOf = (privateKeyPem: string): string =>
  createPublicKey(privateKeyPem)
    .export({ type: 'spki', format: 'pem' })
    .toString();

const required = (inputs: ClusterSeedInputs, name: string): string => {
  const value = inputs.secrets[name];
  if (value === undefined || value === '')
    throw new Error(`cluster seed: the secret "${name}" was not supplied`);
  return value;
};

/** The rows a cluster seeds: the lab's, rewritten, checked. */
export const clusterRows = (
  labRows: ReadonlyArray<ConfigurationRow>,
  inputs: ClusterSeedInputs,
): ConfigurationRow[] => {
  const publicKey = publicKeyOf(required(inputs, 'jwt-private-key'));
  const keyId = keyIdOf(publicKey);
  const { storefront, backOffice, identity } = inputs.origins;

  const byAddress = (key: string): string | undefined => {
    const fixed: Readonly<Record<string, string>> = {
      'auth-service/zitadel/issuer': identity,
      'auth-service/zitadel/clientId': inputs.zitadelClientId,
      'auth-service/zitadel/pat': required(inputs, 'zitadel-pat'),
      'auth-service/zitadel/actionSigningKey': required(
        inputs,
        'zitadel-action-signing-key',
      ),
      'auth-service/zitadel/redirectUri': `${backOffice}/api/auth/callback`,
      'auth-service/zitadel/postLogoutRedirectUri': `${backOffice}/`,
      'auth-service/jwt/privateKey': required(inputs, 'jwt-private-key'),
      'back-office-app/zitadel/accountUrl': `${identity}/ui/console/users/me`,
      'order-service/order/storefrontUrl': storefront,
      'order-service/smtp/host': inputs.smtp.host,
      'order-service/smtp/port': inputs.smtp.port,
      'order-service/smtp/from': inputs.smtp.from,
      'transaction-service/workflow/url': required(
        inputs,
        'workflow-database-url',
      ),
      // Every pod is handed its own address as `WORKFLOW_RUNNER_HOST`, which
      // wins over this row; the row names the Service so a runner started
      // without it is still reachable rather than registered at loopback.
      'transaction-service/workflow/runnerHost': 'transaction-service',
    };
    return fixed[key];
  };

  const rewrite = (row: ConfigurationRow): string => {
    const fixed = byAddress(`${row.service}/${row.group_name}/${row.key}`);
    if (fixed !== undefined) return fixed;
    if (row.group_name === 'mongo' && row.key === 'uri')
      return required(inputs, mongoSecretOf(row.service));
    if (
      (row.group_name === 'rabbitmq' || row.group_name === 'amqp') &&
      row.key === 'uri'
    )
      return required(inputs, 'rabbitmq-uri');
    if (row.group_name === 'redis' && row.key === 'uri')
      return required(inputs, 'redis-uri');
    if (row.group_name === 'jwt' && row.key === 'publicKey') return publicKey;
    if (row.group_name === 'jwt' && row.key === 'keyId') return keyId;
    if (row.group_name === 'otel' && row.key === 'endpoint')
      return CLUSTER_OTEL_ENDPOINT;
    if (row.group_name === 'otel' && row.key === 'metricIntervalMs')
      return CLUSTER_METRIC_INTERVAL_MS;
    if (row.group_name === 'logging' && row.key === 'level')
      return CLUSTER_LOG_LEVEL;
    const token = LAB_TOKENS[row.value];
    if (token !== undefined) return required(inputs, token);
    return row.value.replace(
      /http:\/\/(?:localhost|127\.0\.0\.1):(31\d\d)/g,
      (url, port: string) => {
        const name = SERVICE_PORTS[port];
        return name === undefined ? url : `http://${name}:${port}`;
      },
    );
  };

  const rows = labRows.map(row => ({ ...row, value: rewrite(row) }));
  const stale = rows.filter(row => LAB_VALUE.test(row.value));
  if (stale.length > 0)
    throw new Error(
      `cluster seed: these rows still hold a lab value — teach cluster-seed.ts to rewrite them:\n  ${stale
        .map(row => `${row.service} / ${row.group_name} / ${row.key}`)
        .join('\n  ')}`,
    );
  return rows;
};

/**
 * Which seed this process boots with. `lab` unless the cluster says
 * otherwise; `cluster` reads its inputs from `CONFIG_SEED_FILE` and refuses to
 * start without them, since a cluster seeded with lab rows would be reachable
 * by anyone holding the repository's development key.
 */
export const seedRowsFor = (
  env: Readonly<Record<string, string | undefined>>,
  labRows: ReadonlyArray<ConfigurationRow>,
  read: (path: string) => string = path => readFileSync(path, 'utf8'),
): ReadonlyArray<ConfigurationRow> => {
  const profile = env['CONFIG_SEED_PROFILE'] ?? 'lab';
  if (profile === 'lab') return labRows;
  if (profile !== 'cluster')
    throw new Error(
      `CONFIG_SEED_PROFILE is "${profile}"; it is "lab" or "cluster"`,
    );
  const path = env['CONFIG_SEED_FILE'];
  if (path === undefined || path === '')
    throw new Error('CONFIG_SEED_PROFILE=cluster needs CONFIG_SEED_FILE');
  return clusterRows(labRows, JSON.parse(read(path)) as ClusterSeedInputs);
};
