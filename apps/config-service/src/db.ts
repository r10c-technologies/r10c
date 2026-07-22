import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Config, Effect, Layer, Redacted } from 'effect';

/**
 * A row of the `configuration` table — the Postgres-backed source of truth for
 * cross-service configuration. `service` is the consumer (path param of
 * `GET /api/config/:service`), `group_name`/`key`/`value` mirror the
 * `ConfigurationPlain` shape (`{ [group]: [{ key, value }] }`).
 */
export interface ConfigurationRow {
  readonly service: string;
  readonly group_name: string;
  readonly key: string;
  readonly value: string;
}

/**
 * Seed configuration inserted on first boot (empty table). Holds the fleet's
 * service-discovery URIs plus the Mongo connection settings the Mongo-backed
 * services resolve at boot. Local-dev defaults (minikube NodePorts); production
 * overrides live in the table itself.
 */
const SEED_ROWS: ReadonlyArray<ConfigurationRow> = [
  // Frontend → backend service URIs.
  {
    service: 'marketplace-admin-app',
    group_name: 'uri',
    key: 'marketplace-admin-service-domain',
    value: 'http://localhost:3101/api',
  },
  {
    service: 'marketplace-app',
    group_name: 'uri',
    key: 'marketplace-service-domain',
    value: 'http://localhost:3100/api',
  },
  {
    service: 'auth-app',
    group_name: 'uri',
    key: 'auth-service-domain',
    value: 'http://localhost:3102/api',
  },
  // Backend → MongoDB connection settings (consumed at boot).
  {
    service: 'marketplace-admin-service',
    group_name: 'mongo',
    key: 'uri',
    value: 'mongodb://admin:password@127.0.0.1:30017',
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'mongo',
    key: 'db',
    value: 'marketplace_admin',
  },
  {
    service: 'auth-service',
    group_name: 'mongo',
    key: 'uri',
    value: 'mongodb://admin:password@127.0.0.1:30017',
  },
  { service: 'auth-service', group_name: 'mongo', key: 'db', value: 'auth' },
  // auth-service session store (Redis) — the single source of truth for live
  // sessions every service can read.
  {
    service: 'auth-service',
    group_name: 'redis',
    key: 'uri',
    value: 'redis://:localdev@127.0.0.1:30379',
  },
  // Shared HS256 secret: auth-service signs access tokens with it, every
  // verifier checks against it. LOCAL DEV ONLY — replace per environment.
  {
    service: 'auth-service',
    group_name: 'jwt',
    key: 'secret',
    value: 'dev-jwt-secret-change-me-at-least-32-chars',
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'jwt',
    key: 'secret',
    value: 'dev-jwt-secret-change-me-at-least-32-chars',
  },
  // Transaction event bus (Redis locks/sequences + RabbitMQ) for the admin
  // service's transactional writes.
  {
    service: 'marketplace-admin-service',
    group_name: 'redis',
    key: 'uri',
    value: 'redis://:localdev@127.0.0.1:30379',
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
  },
  // transaction-manager: its own Mongo db + the same RabbitMQ bus it tracks.
  {
    service: 'transaction-manager',
    group_name: 'mongo',
    key: 'uri',
    value: 'mongodb://admin:password@127.0.0.1:30017',
  },
  {
    service: 'transaction-manager',
    group_name: 'mongo',
    key: 'db',
    value: 'transaction_manager',
  },
  {
    service: 'transaction-manager',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
  },
];

const DEFAULT_PG_URL = 'postgres://postgres:postgres@127.0.0.1:30432/postgres';

/** Postgres client layer; `CONFIG_PG_URL` is the bootstrap connection string. */
const PgClientLive = PgClient.layerConfig({
  url: Config.redacted('CONFIG_PG_URL').pipe(
    Config.withDefault(Redacted.make(DEFAULT_PG_URL))
  ),
});

/**
 * Creates the `configuration` table and reconciles the seed on every boot.
 *
 * Seeding is per-row `ON CONFLICT DO NOTHING` (the PK is
 * `service/group_name/key`), not a one-shot "insert only when the table is
 * empty". That distinction matters: a table seeded before a new key was added
 * to {@link SEED_ROWS} would otherwise never gain that key, and a service that
 * resolves it at boot would crash with `Configuration key "…" not found`.
 * `DO NOTHING` (not `DO UPDATE`) means an operator's in-place override of a
 * value is never clobbered — only genuinely missing rows are inserted.
 */
const migrateAndSeed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS configuration (
      service text NOT NULL,
      group_name text NOT NULL,
      key text NOT NULL,
      value text NOT NULL,
      PRIMARY KEY (service, group_name, key)
    )
  `;

  yield* sql`INSERT INTO configuration ${sql.insert(
    SEED_ROWS as unknown as Record<string, unknown>[]
  )} ON CONFLICT (service, group_name, key) DO NOTHING`;
});

/**
 * The config-service data layer: provides {@link SqlClient} and runs the
 * migration/seed once on startup.
 */
export const DbLive = Layer.provideMerge(
  Layer.effectDiscard(migrateAndSeed),
  PgClientLive
).pipe(Layer.orDie);
