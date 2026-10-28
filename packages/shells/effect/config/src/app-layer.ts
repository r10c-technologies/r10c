import { PgClient } from '@effect/sql-pg';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { ConfigurationRepositoryTag, TokenServiceTag } from '@entifix/business';
import { ConfigurationClientInMemory } from '@entifix/core';
import { makeJoseTokenService } from '@entifix/jwt';
import { observabilityFromConfiguration } from '@entifix/service-shell/observability';
import { SqlHealthProbeLayer } from '@entifix/sql';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  r10cServiceCrossingPolicy,
  ROLE_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import { ConfigurationStoreLocationTag } from '@r10c/implementation-configuration-http';
import {
  ConfigurationLookupLayer,
  ConfigurationRepositoryFactoryLayer,
  ConfigurationWriterLayer,
} from '@r10c/implementation-configuration-sql';
import { Config, Effect, Layer, Redacted } from 'effect';
import { SqlClient } from 'effect/sql';

/**
 * This service's key in its own `configuration` table — the plain name, matching
 * the `service` column of every other row. Deliberately not the package name
 * used for logs and tracing.
 */
const SERVICE_NAME = 'config-service';

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
  /**
   * Marks the value as a credential. A read through the CRUD blanks it, and a
   * write treats an empty incoming value as "leave it alone", so it can be
   * replaced but never read back. Defaults to `false` when a seed row omits it.
   */
  readonly is_secret?: boolean;
}

const DEFAULT_PG_URL = 'postgres://postgres:postgres@127.0.0.1:30432/postgres';

/** Postgres client layer; `CONFIG_PG_URL` is the bootstrap connection string. */
const PgClientLive = PgClient.layerConfig({
  url: Config.Redacted('CONFIG_PG_URL').pipe(
    Config.withDefault(Redacted.make(DEFAULT_PG_URL)),
  ),
});

/**
 * Migrates the `configuration` schema and reconciles the seed on every boot.
 *
 * Seeding is per-row `ON CONFLICT DO NOTHING` against the natural
 * `(service, group_name, key)` key, not a one-shot "insert only when the table
 * is empty". That distinction matters: a table seeded before a new key was added
 * to the seed rows would otherwise never gain that key, and a service that
 * resolves it at boot would crash with `Configuration key "…" not found`.
 * `DO NOTHING` (not `DO UPDATE`) means an operator's in-place override of a
 * value is never clobbered — only genuinely missing rows are inserted. That is
 * also why editing a value through the CRUD is safe: the next boot leaves it be.
 */
export const migrateAndSeed = (rows: ReadonlyArray<ConfigurationRow>) =>
  Effect.gen(function* () {
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

    // Every statement below is additive and idempotent, so a fresh database and one
    // seeded by an earlier release converge on the same shape through one code path.
    yield* sql`ALTER TABLE configuration ADD COLUMN IF NOT EXISTS id text`;
    yield* sql`ALTER TABLE configuration ALTER COLUMN id SET DEFAULT gen_random_uuid()::text`;
    yield* sql`UPDATE configuration SET id = gen_random_uuid()::text WHERE id IS NULL`;
    yield* sql`ALTER TABLE configuration ALTER COLUMN id SET NOT NULL`;
    yield* sql`ALTER TABLE configuration ADD COLUMN IF NOT EXISTS is_secret boolean NOT NULL DEFAULT false`;
    yield* sql`ALTER TABLE configuration ADD COLUMN IF NOT EXISTS updated_at timestamptz`;
    yield* sql`ALTER TABLE configuration ADD COLUMN IF NOT EXISTS updated_by text`;

    // An entity is addressed by a single `EntityId`, so `id` has to be the primary
    // key; the natural `(service, group_name, key)` triple stays enforced as a
    // UNIQUE constraint, which is also what the seed's `ON CONFLICT` targets.
    //
    // Guarded on the primary key still spanning three columns, so it runs exactly
    // once — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, and an unguarded
    // drop/re-add would churn the constraint on every boot.
    yield* sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'configuration_pkey'
          AND conrelid = 'configuration'::regclass
          AND array_length(conkey, 1) = 3
      ) THEN
        ALTER TABLE configuration DROP CONSTRAINT configuration_pkey;
        ALTER TABLE configuration ADD CONSTRAINT configuration_natural_key
          UNIQUE (service, group_name, key);
        ALTER TABLE configuration ADD CONSTRAINT configuration_pkey PRIMARY KEY (id);
      END IF;
    END $$;
  `;

    // The audit log. Append-only: every write to `configuration` adds a row here in
    // the same transaction, so "who changed this, and when" survives the next write.
    // A secret's plaintext is never recorded — `secret_changed` says only that it
    // moved, which is the part an operator needs.
    yield* sql`
    CREATE TABLE IF NOT EXISTS configuration_audit (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      configuration_id text NOT NULL,
      service text NOT NULL,
      group_name text NOT NULL,
      key text NOT NULL,
      action text NOT NULL,
      old_value text,
      new_value text,
      secret_changed boolean NOT NULL DEFAULT false,
      actor_id text NOT NULL,
      actor_email text,
      at timestamptz NOT NULL DEFAULT now()
    )
  `;

    // Reading the log is always "this row's history, newest first".
    yield* sql`
    CREATE INDEX IF NOT EXISTS configuration_audit_row_idx
      ON configuration_audit (configuration_id, at DESC)
  `;

    // `sql.insert` derives its column list from the rows it is given, so every row
    // has to carry the same keys — hence normalising the optional flag here rather
    // than repeating `is_secret: false` twenty times in the seed.
    const seed = rows.map(row => ({
      service: row.service,
      group_name: row.group_name,
      key: row.key,
      value: row.value,
      is_secret: row.is_secret ?? false,
    }));

    yield* sql`INSERT INTO configuration ${sql.insert(
      seed as unknown as Record<string, unknown>[],
    )} ON CONFLICT (service, group_name, key) DO NOTHING`;
  });

/**
 * The `configuration` store's data layer: provides {@link SqlClient} and runs the
 * migration/seed once on startup.
 */
const dbLayer = (rows: ReadonlyArray<ConfigurationRow>) =>
  Layer.provideMerge(
    Layer.effectDiscard(migrateAndSeed(rows)),
    PgClientLive,
  ).pipe(Layer.orDie);

/**
 * Token verification and the authorization policy, resolved from this service's
 * own table.
 *
 * Every other service resolves `jwt.publicKey` from config-service over HTTP.
 * This one cannot — it *is* config-service — so it reads the rows through the
 * `SqlClient` it already holds. That closes the bootstrap cycle rather than
 * hiding it behind a retry, and it means the key lives in exactly one place for
 * the whole fleet.
 *
 * It reads the **public** key only. config-service verifies tokens; it does not
 * mint them, so it has no business holding material that could.
 *
 * A missing row is fatal on purpose: a config-service that answered `401` to
 * every request because it silently failed to load its key would look like an
 * authorization bug from every caller's side.
 */
export const authLayer = Layer.unwrap(
  Effect.gen(function* () {
    // This service's own rows, read through the same lookup it serves every
    // other service from.
    const plain = yield* (yield* ConfigurationLookupTag).forService(
      SERVICE_NAME,
    );
    const jwt = new Map(
      (plain['jwt'] ?? []).map(entry => [entry.key, String(entry.value)]),
    );
    const publicKeyPem = jwt.get('publicKey');
    const keyId = jwt.get('keyId');
    if (publicKeyPem === undefined || keyId === undefined) {
      return yield* Effect.die(
        new Error(
          `config-service cannot verify tokens: no "jwt.publicKey"/"jwt.keyId" rows for "${SERVICE_NAME}"`,
        ),
      );
    }

    // This service's own parameters, as a store.
    //
    // Needed because `EntityRepository` declares `ConfigurationRepositoryTag` in
    // every method's requirement channel — the REST adapters resolve their
    // endpoints through it — so even the SQL adapter, which never reads it, has
    // to be given one. Building it from this service's own rows rather than
    // handing over an empty store keeps it truthful.
    const store = new ConfigurationClientInMemory(plain);
    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    return Layer.mergeAll(
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem,
          keyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      // Static role→permission table today; swapping in an attribute-aware
      // engine is a change of this line alone.
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision(ROLE_PERMISSIONS),
      ),
      Layer.succeed(ServiceCrossingPolicyTag, r10cServiceCrossingPolicy),
      Layer.succeed(ConfigurationRepositoryTag, store),
      // Observability, read from the very rows this service serves to everyone
      // else. It cannot call `loadRemoteConfiguration` — it *is* config-service,
      // and asking itself over HTTP would reopen the bootstrap cycle the key
      // read above closes — but it needs no special path either: the store built
      // from its own table satisfies the same `ConfigurationClient` port every
      // other service hands the helper.
      observability,
    );
  }),
);

/**
 * What the service brings to its slice's composition: the seed rows are the
 * app's data, so they are handed in rather than owned here (ADR 0064).
 */
export interface ConfigShellOptions {
  readonly seedRows: ReadonlyArray<ConfigurationRow>;
}

/**
 * The `config` slice's composition, mounted by config-service alone: the
 * database (migrated and seeded), its readiness probe, and the auth services the
 * guarded CRUD routes need.
 */
export const makeAppLayer = (options: ConfigShellOptions) =>
  Layer.provideMerge(
    Layer.mergeAll(
      SqlHealthProbeLayer(['configuration']),
      authLayer,
      // The `configuration` store, through its cell: reads that blank every
      // secret, and writes audited with the actor in the same transaction.
      ConfigurationRepositoryFactoryLayer,
      ConfigurationWriterLayer,
      // What the fleet's introspection names this store as, redacted on the way out.
      Layer.succeed(
        ConfigurationStoreLocationTag,
        process.env['CONFIG_PG_URL'] ?? DEFAULT_PG_URL,
      ),
    ),
    // The lookup a booting service is served from, with real values.
    Layer.provideMerge(ConfigurationLookupLayer, dbLayer(options.seedRows)),
  ).pipe(Layer.orDie);
