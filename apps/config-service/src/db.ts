import { readFileSync } from 'node:fs';

import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  ConfigurationRepositoryTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import {
  type ConfigurationPlain,
  ConfigurationStoreInMemory,
} from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import { SqlHealthProbeLayer } from '@r10c/entifix-ts-sql-client';
import { Config, Effect, Layer, Redacted } from 'effect';

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

/**
 * The local-development signing pair, committed exactly as the old shared
 * secret was: a working default so `dev:reset` produces a fleet that can sign
 * in, and a value no deployment may keep.
 *
 * Naming the key `dev-` is deliberate — the `kid` travels in every token
 * header, so a token minted by a machine still running this pair announces
 * itself as such.
 */
const DEV_KEY_ID = 'dev-2026-08';

/**
 * Zitadel's per-instance values, which cannot be committed and cannot be
 * invented.
 *
 * The OIDC app's client id and the seed machine's token are minted when the
 * instance is first initialised, so `infra/local/ensure.sh`'s L6 rung extracts
 * them into `infra/local/zitadel/.generated.env` (gitignored) and this seed
 * reads them from there. An environment variable wins when set, which is what
 * lets a non-local deployment supply them without a file.
 *
 * Reading a file from the repo at boot would be wrong anywhere else; it is
 * right here because both halves are recreated together — `dev:reset` wipes the
 * Zitadel instance *and* this Postgres, so a stale pair cannot survive one. The
 * seed is `ON CONFLICT DO NOTHING`, so without that pairing an old client id
 * would outlive the instance it named and every sign-in would fail with a
 * mystery.
 */
const readGeneratedZitadelEnv = (): Record<string, string> => {
  const values: Record<string, string> = {};
  try {
    // Resolved from the repo root rather than the bundle, which webpack moves.
    const path = `${process.cwd()}/infra/local/zitadel/.generated.env`;
    const contents = readFileSync(path, 'utf8');
    for (const line of contents.split('\n')) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match !== null) values[match[1] as string] = match[2] as string;
    }
  } catch {
    // Absent is normal: nothing has seeded the instance yet, or this is not a
    // local machine. The rows below then seed empty and the service says so
    // through its readiness probe rather than guessing a value.
  }
  return values;
};

const GENERATED_ZITADEL = readGeneratedZitadelEnv();

const zitadelValue = (name: string, fallback = ''): string =>
  process.env[name] ?? GENERATED_ZITADEL[name] ?? fallback;

const DEV_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQChlw1RgBhMTBk2
1/+XJ4lcuDvRVG15iQ/xPznwkwPFoIfr+CyJ09LNdqEvD6gBQ/YLyAPHOev/36+B
10zI8Nhb3AG/Ysdt/ZzRaMjMME/ZOXQYNhAPL8a11bNFZlym+NPhyd6LXTwr72qK
hzOr7c61L8RXL/gjAI2+VRzhKmKsnbz1WsEPNKxnn/0ejiVSVTygQca1DH9lYP4L
jsCqML0Dv72f2q8V84bMY/V1RfLb3VX5/Oe3B8GaQknvDUo7BbTYzL61jNOQDh/I
LWI2hXbn15tSFw6A9xnfwlPOI47h9ORvUInTx99rkizCyhADcOKNyIBfyntdRRLc
On26yCTxAgMBAAECggEAAKyvMC69ShWaxpdX3ZOEc8Tbpv8CGHLm9qTXgTX05mMK
NoBz0DdM8tzJB6n8fLCmqVGN0NdC+nQjA0VzQGJz7cOYl6oWmnu3qWoXt7VsBzIa
2uZXFwS2B6LqyLWxufIa4WYnoMC3so84HFgFFtWH1MY1deRSSo+dV9zj7yjxt3Po
YjRWzlWshlpiVbppOlmYkj14gBpmXdGY8RvubAcH3jz1DtbEmSrvLp/Y1T0UpTT/
FAGmOvlJctdNd5StDTON0EB85U6jL417r5D33YxP1DoOdGB6JJZjONx5ns26Qry+
tsfzTsYm045MxK5Prjj2q1GmZQRM0iH4JAdDXEnbAQKBgQDPaGtfWFM8xaRMCig1
WLKDXGu7OO1GyBNGvaBbgrclVLmIBfjDfBYXUeeI9j2ClUq95eqya86qb9ILsLrw
YjG0c2aZxLqSgnagy0G5X1P7l0xOKKzH7kD+CvGQh9ymomsOfmyWevMTNqUwynU4
hNZQ+zlaOFiCa8uT9pnXV8JTAQKBgQDHcqSYpt3TGL+jCezRII70Z0NX1ljZA7vn
/KHYIUc13VKuAD3U+DO/YQ9kPJwEoV+0kvOmdiz5M+DWNbMEiKG5nKbH84FtiB2r
I4Jk7PvgDeeYLwBmz/lIwZtmr0OQR57eXQPZia2YRWq9CvajHJV5J4Ty0P/hbcpI
FUxWO4UB8QKBgGwgbcmZDFvkVZDmwqt9ACOHbQp/1QNPju0UMqNCdCRcFRUat+OB
ryqdIm2+obaQChUR5db6aRVlkkVR70MejfcbKmQDsZhrt1iAXlU7o1bIO5mLjvfz
96H5JpJIofmlNtaphga1Nj/P/zJ+ebnrVqeFMRMdyNbFR65toyomsEIBAoGADO/f
w1MXkmjJjW7IYKxG+Y11Lc5mhvUaDCsz6EwITXMkuMqlOBo9aQ2HrQ3NZPN+vLzH
dyW1NxjpXZuwF/ww2VRS8SdXXt50ZjRwcdF5aQgd3J433XNiDRkZ1mhJ7qLmqC/K
XyLyEq12BfsfEmd5PpmUoxdxcZLoixJumC1WLFECgYAQ8GsPM0AcDDten4clTKqI
mxPofbYw1NAyPYGM2ducPTMUF5uet6jIpR85HTfUybHAyue4fvzdTST6xtCGg9IT
eoAPicXCyemAC4DfLR7sZEcmHRrh8bKRnnrcuXdN6rTG8v9kicecrsUEqJex/Dm1
vZ/i+LIy8zYN3CmCxN0vIg==
-----END PRIVATE KEY-----
`;

const DEV_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoZcNUYAYTEwZNtf/lyeJ
XLg70VRteYkP8T858JMDxaCH6/gsidPSzXahLw+oAUP2C8gDxznr/9+vgddMyPDY
W9wBv2LHbf2c0WjIzDBP2Tl0GDYQDy/GtdWzRWZcpvjT4cnei108K+9qioczq+3O
tS/EVy/4IwCNvlUc4SpirJ289VrBDzSsZ5/9Ho4lUlU8oEHGtQx/ZWD+C47AqjC9
A7+9n9qvFfOGzGP1dUXy291V+fzntwfBmkJJ7w1KOwW02My+tYzTkA4fyC1iNoV2
59ebUhcOgPcZ38JTziOO4fTkb1CJ08ffa5IswsoQA3DijciAX8p7XUUS3Dp9usgk
8QIDAQAB
-----END PUBLIC KEY-----
`;

/**
 * Seed configuration inserted on first boot (empty table). Holds the fleet's
 * service-discovery URIs plus the Mongo connection settings the Mongo-backed
 * services resolve at boot. Local-dev defaults (minikube NodePorts); production
 * overrides live in the table itself.
 */
const SEED_ROWS: ReadonlyArray<ConfigurationRow> = [
  // Locale policy, per frontend. `default` is what an unprefixed URL negotiates
  // to when the visitor has no cookie and their `Accept-Language` names nothing
  // we speak; `supported` is the set the middleware will honour in a path
  // prefix. Operators can narrow a deployment to one language by editing these
  // without a rebuild.
  {
    service: 'marketplace-app',
    group_name: 'locale',
    key: 'default',
    value: 'es',
  },
  {
    service: 'marketplace-app',
    group_name: 'locale',
    key: 'supported',
    value: 'es,en',
  },
  {
    service: 'marketplace-admin-app',
    group_name: 'locale',
    key: 'default',
    value: 'es',
  },
  {
    service: 'marketplace-admin-app',
    group_name: 'locale',
    key: 'supported',
    value: 'es,en',
  },
  {
    service: 'auth-app',
    group_name: 'locale',
    key: 'default',
    value: 'es',
  },
  {
    service: 'auth-app',
    group_name: 'locale',
    key: 'supported',
    value: 'es,en',
  },

  // Frontend → backend service URIs.
  {
    service: 'marketplace-admin-app',
    group_name: 'uri',
    key: 'marketplace-admin-service-domain',
    value: 'http://localhost:3101/api',
  },
  // config-service's own address, so the admin app's system-management pages can
  // reach the configuration CRUD. The app rewrites it to a same-origin proxy path
  // before the browser sees it, exactly like the admin-service domain above.
  {
    service: 'marketplace-admin-app',
    group_name: 'uri',
    key: 'config-service-domain',
    value: 'http://localhost:3190/api',
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
    is_secret: true,
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'mongo',
    key: 'db',
    value: 'marketplace_admin',
  },
  // Tenant storage. The catalog is tenant plane: each organization authors its
  // own, in its own Mongo database named `<dbPrefix><organizationId>`. The name
  // is derived from the id rather than from a slug so renaming an organization
  // can never strand its data, and `client.db()` is a handle rather than a
  // connection, so N organizations share one pool.
  {
    service: 'marketplace-admin-service',
    group_name: 'tenant',
    key: 'dbPrefix',
    value: 'tenant_',
  },
  // The local demo vendor. Both services need the same id — auth-service seeds
  // the `Organization`/`Membership` records under it, marketplace-admin-service
  // seeds that vendor's catalog into its database — so it is configuration
  // rather than a constant duplicated in two codebases.
  {
    service: 'marketplace-admin-service',
    group_name: 'tenant',
    key: 'demoOrganizationId',
    value: 'demo-organization',
  },
  {
    service: 'auth-service',
    group_name: 'tenant',
    key: 'demoOrganizationId',
    value: 'demo-organization',
  },
  {
    service: 'auth-service',
    group_name: 'mongo',
    key: 'uri',
    value: 'mongodb://admin:password@127.0.0.1:30017',
    is_secret: true,
  },
  { service: 'auth-service', group_name: 'mongo', key: 'db', value: 'auth' },
  // auth-service session store (Redis) — the single source of truth for live
  // sessions every service can read.
  {
    service: 'auth-service',
    group_name: 'redis',
    key: 'uri',
    value: 'redis://:localdev@127.0.0.1:30379',
    is_secret: true,
  },
  // Access tokens are RS256. auth-service is the only holder of the private
  // key; every other service gets the public half and can therefore verify a
  // token but never mint one — which is what lets the public storefront verify
  // a buyer's session without holding material that could sign an operator's.
  //
  // LOCAL DEV ONLY. Generate a real pair per environment with:
  //   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | \
  //     tee private.pem | openssl pkey -pubout
  {
    service: 'auth-service',
    group_name: 'jwt',
    key: 'privateKey',
    value: DEV_PRIVATE_KEY_PEM,
    is_secret: true,
  },
  {
    service: 'auth-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'auth-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // Where identity itself lives. auth-service verifies an `id_token` against
  // the issuer and drives user lifecycle with the machine token; it holds no
  // password, and there is no row here that could give it one.
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'issuer',
    value: zitadelValue('ZITADEL_ISSUER', 'http://localhost:30080'),
  },
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'clientId',
    value: zitadelValue('ZITADEL_CLIENT_ID'),
  },
  // `is_secret` is what keeps this out of the unauthenticated `/api/config`
  // response. A machine token is a full-privilege credential at the provider —
  // it can create and delete users — so a row that forgot the flag would put it
  // in a public body.
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'pat',
    value: zitadelValue('ZITADEL_PAT'),
    is_secret: true,
  },
  // The browser comes back to the APP, never to the service: auth-app is what
  // owns cookies. It must match a redirect URI registered on the OIDC app or
  // Zitadel refuses the authorization outright.
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'redirectUri',
    value: zitadelValue(
      'ZITADEL_REDIRECT_URI',
      'http://localhost:3002/api/auth/callback',
    ),
  },
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'postLogoutRedirectUri',
    value: zitadelValue(
      'ZITADEL_POST_LOGOUT_REDIRECT_URI',
      'http://localhost:3002/',
    ),
  },
  // Where the account page sends someone to change a password, enrol a second
  // factor or link a social account. Self-service is the provider's screen now,
  // so this is a link rather than a feature.
  {
    service: 'auth-app',
    group_name: 'zitadel',
    key: 'accountUrl',
    value: zitadelValue(
      'ZITADEL_ACCOUNT_URL',
      'http://localhost:30080/ui/console/users/me',
    ),
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // config-service verifies access tokens too, now that it serves a guarded CRUD.
  // It reads these rows straight out of its own table via SQL at boot rather
  // than over HTTP from itself, so there is no bootstrap cycle.
  {
    service: 'config-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'config-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // Transaction event bus (Redis locks/sequences + RabbitMQ) for the admin
  // service's transactional writes.
  {
    service: 'marketplace-admin-service',
    group_name: 'redis',
    key: 'uri',
    value: 'redis://:localdev@127.0.0.1:30379',
    is_secret: true,
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  // Observability: log level + sink, and the OTLP endpoint the tooling logger and
  // the tracing SDK export to. In local dev the service runs on the host and ships
  // straight to the `grafana/otel-lgtm` NodePort (there is no pod to tail); in a
  // cluster this points at the node-local Collector and the sink becomes `stdout`.
  {
    service: 'marketplace-admin-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'marketplace-admin-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  // transaction-manager: its own Mongo db + the same RabbitMQ bus it tracks.
  {
    service: 'transaction-manager',
    group_name: 'mongo',
    key: 'uri',
    value: 'mongodb://admin:password@127.0.0.1:30017',
    is_secret: true,
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
    is_secret: true,
  },
];

const DEFAULT_PG_URL = 'postgres://postgres:postgres@127.0.0.1:30432/postgres';

/** Postgres client layer; `CONFIG_PG_URL` is the bootstrap connection string. */
const PgClientLive = PgClient.layerConfig({
  url: Config.redacted('CONFIG_PG_URL').pipe(
    Config.withDefault(Redacted.make(DEFAULT_PG_URL)),
  ),
});

/**
 * Migrates the `configuration` schema and reconciles the seed on every boot.
 *
 * Seeding is per-row `ON CONFLICT DO NOTHING` against the natural
 * `(service, group_name, key)` key, not a one-shot "insert only when the table
 * is empty". That distinction matters: a table seeded before a new key was added
 * to {@link SEED_ROWS} would otherwise never gain that key, and a service that
 * resolves it at boot would crash with `Configuration key "…" not found`.
 * `DO NOTHING` (not `DO UPDATE`) means an operator's in-place override of a
 * value is never clobbered — only genuinely missing rows are inserted. That is
 * also why editing a value through the CRUD is safe: the next boot leaves it be.
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
  const seed = SEED_ROWS.map(row => ({
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
 * The config-service data layer: provides {@link SqlClient} and runs the
 * migration/seed once on startup.
 */
export const DbLive = Layer.provideMerge(
  Layer.effectDiscard(migrateAndSeed),
  PgClientLive,
).pipe(Layer.orDie);

/**
 * Readiness probe for the Postgres connection.
 *
 * Re-exported from `@r10c/entifix-ts-sql-client`, where it moved once a second
 * relational consumer became possible: the probe is a plain `SELECT 1` with
 * nothing config-service-specific about it. The alias keeps this app's existing
 * import name working.
 */
export { SqlHealthProbeLayer as PostgresHealthProbeLayer };

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
const AuthLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const rows = yield* sql<{ readonly key: string; readonly value: string }>`
      SELECT key, value FROM configuration
      WHERE service = ${SERVICE_NAME}
        AND group_name = 'jwt'
        AND key IN ('publicKey', 'keyId')
    `;
    const jwt = new Map(rows.map(row => [row.key, row.value]));
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
    const own = yield* sql<{
      readonly group_name: string;
      readonly key: string;
      readonly value: string;
      readonly is_secret: boolean;
    }>`
      SELECT group_name, key, value, is_secret FROM configuration WHERE service = ${SERVICE_NAME}
    `;
    const plain: ConfigurationPlain = {};
    for (const row of own) {
      (plain[row.group_name] ??= []).push({
        key: row.key,
        value: row.value,
        ...(row.is_secret === true ? { isSecret: true } : {}),
      });
    }

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
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
      Layer.succeed(
        ConfigurationRepositoryTag,
        new ConfigurationStoreInMemory(plain),
      ),
    );
  }),
);

/**
 * The service's composition root: the database (migrated and seeded), its
 * readiness probe, and the auth services the guarded CRUD routes need.
 */
export const AppLayer = Layer.provideMerge(
  Layer.mergeAll(SqlHealthProbeLayer, AuthLive),
  DbLive,
).pipe(Layer.orDie);
