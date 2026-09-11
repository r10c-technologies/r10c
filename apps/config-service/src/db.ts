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
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import { SqlHealthProbeLayer } from '@r10c/entifix-ts-sql-client';
import { observabilityFromConfiguration } from '@r10c/shells-effect-service';
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
const MONGO_URI =
  'mongodb://admin:password@127.0.0.1:30017/?directConnection=true';

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
    service: 'back-office-app',
    group_name: 'locale',
    key: 'default',
    value: 'es',
  },
  {
    service: 'back-office-app',
    group_name: 'locale',
    key: 'supported',
    value: 'es,en',
  },

  // Frontend → backend service URIs.
  //
  // The storefront's is the odd one: marketplace-app resolves it in a **server
  // component** and calls the address directly, so unlike the back office's
  // rows it is never rewritten to a same-origin proxy path. There is no browser
  // in that path to hide an address from, and the reads it makes are
  // unauthenticated by design.
  {
    service: 'marketplace-app',
    group_name: 'uri',
    key: 'marketplace-service-domain',
    value: 'http://localhost:3100/api',
  },
  // Where checkout starts. The storefront's server action calls
  // transaction-service directly, so this address stays server-side for the
  // reason the row above does — and here it *must*, because the call carries a
  // crossing token no browser may ever hold.
  {
    service: 'marketplace-app',
    group_name: 'uri',
    key: 'transaction-service-domain',
    value: 'http://localhost:3103/api',
  },
  // ⚠️ **The token the storefront presents to start a checkout**, matching
  // transaction-service's inbound `service.token`. It is read in a server action
  // and never reaches the browser: a storefront with no auth gate cannot prove
  // who the buyer is, so what it proves instead is that the *fleet* is asking —
  // which is exactly what a crossing token is for
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  //
  // It is deliberately **not** a participant token: it starts a flow, it does
  // not write a vendor's stock.
  {
    service: 'marketplace-app',
    group_name: 'service',
    key: 'sagaToken',
    value: 'dev-saga-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'marketplace-admin-service-domain',
    value: 'http://localhost:3101/api',
  },
  // transaction-service, which a catalog `202` hands the browser off to. It was
  // reachable through the admin domain above while the `transaction` slice was
  // co-deployed there; it took `:3103` when ADR 0039's trigger fired (#229), so
  // it needs a domain key — and therefore a proxy path — of its own. The app
  // rewrites this to `/api/transaction` before the browser sees it, which is
  // what keeps the reactive stream same-origin (ADR 0036).
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'transaction-service-domain',
    value: 'http://localhost:3103/api',
  },
  // The second catalog backend. ADR 0022 moved brand, category and the
  // characteristic dictionary to the platform-plane `catalog-reference` store,
  // which marketplace-service owns — a marketplace has to merge a browse tree
  // and per-vendor taxonomy cannot. The back office reads that vocabulary from
  // here; the app rewrites this to `/api/marketplace` before the browser sees it.
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'marketplace-service-domain',
    value: 'http://localhost:3100/api',
  },
  // stock-service, the back office's third catalog-adjacent backend. Tenant
  // plane and session-guarded end to end, so unlike the marketplace row above
  // this proxy exists for the *reads* too — nothing here is anonymous. The app
  // rewrites it to `/api/stock` before the browser sees it.
  // ⚠️ A rewrite with no row rewrites nothing: `/api/sales` in the config route
  // only takes effect for a domain key the configuration actually carries.
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'sales-service-domain',
    value: 'http://localhost:3109/api',
  },
  // The vendor's commercial terms and their statement. Control plane and
  // single, so unlike the sales and stock rows above it there is no tenancy in
  // the path — what narrows a read here is a predicate built from the session
  // the proxy carries upstream (ADR 0057).
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'settlement-service-domain',
    value: 'http://localhost:3107/api',
  },
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'stock-service-domain',
    value: 'http://localhost:3108/api',
  },
  // order-service, the back office's fourth backend. Platform plane rather than
  // tenant, so the rows are not scoped to the viewer's organization — but the
  // proxy still exists for the reads, because nothing here is anonymous either.
  // The app rewrites it to `/api/order` before the browser sees it.
  //
  // ⚠️ **A rewrite with no row rewrites nothing.** `createConfigRoute` maps the
  // rows it is given; a proxy entry naming a key config-service never serves
  // leaves the browser composing URLs from an address it does not have — the
  // nav appears, the screen loads, and every query fails. Caught on the live lab
  // rather than by any check, because both halves look correct in isolation.
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'order-service-domain',
    value: 'http://localhost:3105/api',
  },
  // config-service's own address, so the admin app's system-management pages can
  // reach the configuration CRUD. The app rewrites it to a same-origin proxy path
  // before the browser sees it, exactly like the admin-service domain above.
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'config-service-domain',
    value: 'http://localhost:3190/api',
  },
  // How every service reaches the local mongod.
  //
  // `directConnection=true` is **local only** and load-bearing here: mongod runs
  // as a single-node replica set (transactions do not exist on a standalone
  // server, and the catalog write needs its entity and outbox entry to commit
  // as one fact — ADR 0028). A replica set advertises its in-cluster member
  // address, which resolves to nothing on the host, so a driver doing topology
  // discovery hangs against a perfectly healthy server.
  //
  // It must NOT survive into a real deployment. Against a hosted 3-node set the
  // URI is `mongodb+srv://`, and `directConnection` there pins the driver to one
  // member and defeats failover entirely — the opposite of what it does here.
  // Backend → MongoDB connection settings (consumed at boot). No `mongo.db`:
  // this service owns no single named database. Every catalog handle is a
  // per-organization `tenant_<id>` resolved inside the request, so a name here
  // would create a database nothing writes — the phantom store ADR 0020 rules
  // out. The saga store below names its own.
  {
    service: 'marketplace-admin-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
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
  // How many times the outbox relay tries to publish an entry before
  // quarantining it and moving to the next one. Configuration rather than a
  // constant because raising it while a flaky broker settles should not need a
  // deploy; the next sweep reads the new value. Deliberately *not* the source
  // of a subscription's `maxAttempts`, which becomes an immutable
  // `x-delivery-limit` on a declared queue and so cannot be re-tuned in place.
  {
    service: 'marketplace-admin-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
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
    value: MONGO_URI,
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
  // The shared secret behind `POST /api/auth/provider-events`, which is how a
  // user deactivated at the provider loses their r10c sessions. Zitadel mints it
  // when the Actions v2 target is created and never serves it again, so the seed
  // stamps it into `.generated.env` and carries it forward — a key that rotated
  // here without this row changing would leave the webhook rejecting everything,
  // silently, since `ON CONFLICT DO NOTHING` never rewrites an existing value.
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'actionSigningKey',
    value: zitadelValue('ZITADEL_ACTION_SIGNING_KEY'),
    is_secret: true,
  },
  // How often the reconciler asks the provider what it missed. Three minutes:
  // slow enough that a lab with no lifecycle events costs one idle round trip
  // per pass, fast enough that the gap the webhook cannot cover — a user
  // deactivated while auth-service was down — closes in minutes rather than
  // lasting to the session's seven-day ceiling (#65).
  //
  // ⚠️ **Not a retry policy.** The webhook is the primary mechanism and is
  // unchanged; this is the backstop for the window where it cannot be
  // delivered at all, because the Actions v2 target is fire-and-forget.
  {
    service: 'auth-service',
    group_name: 'lifecycle',
    key: 'sweepIntervalMs',
    value: '180000',
  },
  // The browser comes back to the APP, never to the service: the app is what
  // owns cookies. It must match a redirect URI registered on the OIDC app or
  // Zitadel refuses the authorization outright. That app is back-office-app
  // now, on :3001 — changing this value needs a `dev:reset`, because the seed
  // is ON CONFLICT DO NOTHING and will not rewrite a row that already exists.
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'redirectUri',
    value: zitadelValue(
      'ZITADEL_REDIRECT_URI',
      'http://localhost:3001/api/auth/callback',
    ),
  },
  {
    service: 'auth-service',
    group_name: 'zitadel',
    key: 'postLogoutRedirectUri',
    value: zitadelValue(
      'ZITADEL_POST_LOGOUT_REDIRECT_URI',
      'http://localhost:3001/',
    ),
  },
  // Observability, same four rows every service gets. auth-service had none
  // until the layer became shared, so sign-in, back-channel logout and the
  // provider lifecycle webhook were invisible in Grafana.
  {
    service: 'auth-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'auth-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'auth-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'auth-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // Where the account page sends someone to change a password, enrol a second
  // factor or link a social account. Self-service is the provider's screen now,
  // so this is a link rather than a feature.
  {
    service: 'back-office-app',
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
  // Observability. Read the same way as the keys above — out of this table via
  // SQL — because config-service cannot fetch its own configuration over HTTP.
  {
    service: 'config-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'config-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'config-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'config-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
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
  // How often the metric reader pushes to the Collector. The endpoint above is
  // the destination; this is the only dial on the metric half, and it is a row
  // rather than a constant so resolution can be traded against export volume
  // without a rebuild.
  {
    service: 'marketplace-admin-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // transaction-service — the saga coordinator. It owns the `saga` store:
  // control plane, single, one named Mongo database.
  //
  // ⚠️ **These rows moved off marketplace-admin-service on 2026-09-08 (#229).**
  // The `transaction` slice used to be co-deployed there, so it needed no `uri`
  // of its own — the pool and the bus were already that service's, and only the
  // database name was the slice's own. This block is what the split carried
  // with it, exactly as that row's note predicted.
  {
    service: 'transaction-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'transaction-service',
    group_name: 'amqp',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'db',
    value: 'transaction_manager',
  },
  // How long a transaction may sit in a non-terminal state before the recovery
  // sweep presumes it stuck and marks it `STALE`. A genuine operational dial:
  // raise it while a slow participant settles, and the next sweep reads the new
  // value.
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'staleTimeoutMs',
    value: '60000',
  },
  // How often that sweep runs. Deliberately *not* the same dial as the timeout
  // above: shortening the interval makes a stuck transaction visible sooner,
  // shortening the timeout changes what counts as stuck. Tuning one by moving
  // the other is how a fleet ends up flagging healthy work.
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'recoveryIntervalMs',
    value: '10000',
  },
  // How long a *saga instance* may sit untouched before a sweep presumes its
  // coordinator is gone and finishes the flow itself (#233).
  //
  // ⚠️ A different window from `staleTimeoutMs` above, which is about
  // single-step transaction records. `updatedAt` is re-stamped before every
  // dispatch, so this must stay above the longest a step legitimately takes —
  // below it, a resume runs underneath a coordinator still waiting on a slow
  // participant, and both dispatch.
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'resumeStaleAfterMs',
    value: '60000',
  },
  // How often the resume sweep runs.
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'resumeIntervalMs',
    value: '30000',
  },
  // How many sweeps may pick one instance up before it is settled `STRANDED`
  // and logged instead. The ceiling ADR 0030 gives an outbox entry, applied to
  // the record that already exists rather than to a second one beside it.
  {
    service: 'transaction-service',
    group_name: 'saga',
    key: 'maxResumeAttempts',
    value: '3',
  },
  // The public half only. This service verifies access tokens and never mints
  // one.
  {
    service: 'transaction-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'transaction-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **This service's own *inbound* crossing token** — what marketplace-app
  // presents to start a checkout. Deliberately a different secret from the
  // outbound `participant.*Token` rows below: the coordinator is both a callee
  // and a caller, and one shared value would mean anyone allowed to *start* a
  // checkout held the key that *writes* a vendor's stock.
  {
    service: 'transaction-service',
    group_name: 'service',
    key: 'token',
    value: 'dev-saga-crossing-token-change-me',
    is_secret: true,
  },
  // The participants checkout dispatches to, and **one crossing token each**.
  //
  // ⚠️ **A token per participant, never one shared across them.** This process
  // is the one ADR 0039 named as concentrating the secret: any holder of a
  // crossing token can name any organization, so a single shared value would
  // make one leak a tenant-data write capability across every service at once.
  // Each is that participant's own `is_secret` row with its own rotation, and
  // each must match the value the participant itself reads
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'stockUrl',
    value: 'http://localhost:3108',
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'stockToken',
    value: 'dev-stock-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'orderUrl',
    value: 'http://localhost:3105',
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'orderToken',
    value: 'dev-order-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'paymentUrl',
    value: 'http://localhost:3106',
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'paymentToken',
    value: 'dev-payment-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'transaction-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'transaction-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'transaction-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'transaction-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // order-service — one checkout, one receipt. It owns the `order` store:
  // **platform** plane and single, so unlike stock-service it names a database
  // at boot rather than resolving one per request. That is forced rather than
  // chosen: a basket can span several vendors, so one order cannot live in any
  // one of their tenant databases.
  {
    service: 'order-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'order-service',
    group_name: 'mongo',
    key: 'db',
    value: 'order',
  },
  {
    service: 'order-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'order-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **This service's own crossing secret**, and it must match
  // `transaction-service`'s `participant.orderToken`. Not stock-service's, and
  // not the fleet's `CONFIG_SERVICE_TOKEN`: one shared value would make a single
  // leak reach two stores at once, and the two grants are not comparable
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  {
    service: 'order-service',
    group_name: 'service',
    key: 'token',
    value: 'dev-order-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'order-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'order-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'order-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'order-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // ⚠️ **The same URI every other service reads**, which is what makes them one
  // exchange rather than two fleets that cannot hear each other.
  {
    service: 'order-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  // How many times the relay tries to publish an entry before quarantining it
  // and moving to the next one. Configuration rather than a constant because
  // raising it while a flaky broker settles should not need a deploy; the next
  // sweep reads the new value. Deliberately *not* the source of a
  // subscription's `maxAttempts`, which becomes an immutable `x-delivery-limit`
  // on a declared queue and so cannot be re-tuned in place.
  {
    service: 'order-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
  // payment-service — taking the money. It owns the `payment` store: **platform**
  // plane and single, so like order-service it names a database at boot. Its own
  // store rather than a corner of `order`, so "which slice writes a payment?"
  // has one answer and a future PSP-facing process can be lifted out without
  // touching orders (ADR 0022).
  {
    service: 'payment-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'payment-service',
    group_name: 'mongo',
    key: 'db',
    value: 'payment',
  },
  {
    service: 'payment-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'payment-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
  {
    service: 'payment-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'payment-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **This service's own crossing secret**, and it must match
  // `transaction-service`'s `participant.paymentToken`. Not order-service's, and
  // not the fleet's `CONFIG_SERVICE_TOKEN`: one shared value would make a single
  // leak reach two stores at once, and these two grants are the least comparable
  // pair in the fleet — one writes a receipt, the other takes money
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  {
    service: 'payment-service',
    group_name: 'service',
    key: 'token',
    value: 'dev-payment-crossing-token-change-me',
    is_secret: true,
  },
  // How the simulated provider answers: `capture`, `authorize` (stop at the
  // hold, the *contra entrega* shape) or `decline`.
  //
  // ⚠️ Configuration rather than a build flag **so a live pass can exercise the
  // saga's compensation path** — forcing a refusal is the only way to prove the
  // flow unwinds, and it must not need a rebuild to do it.
  {
    service: 'payment-service',
    group_name: 'provider',
    key: 'outcome',
    value: 'capture',
  },
  {
    service: 'payment-service',
    group_name: 'provider',
    key: 'declineReason',
    value: 'simulated decline',
  },
  {
    service: 'payment-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'payment-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'payment-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'payment-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // settlement-service — what the platform owes each vendor, and on what terms.
  // It owns the `settlement` store: **control** plane and single, so like
  // order-service and payment-service it names a database at boot. The plane is
  // the one thing that differs from its commerce neighbours, and it is not an
  // oversight: a plane answers *who may read it*, and an `Agreement` is the
  // platform's own record about a vendor — the same character as `Entitlement`
  // (ADR 0022 §8).
  {
    service: 'settlement-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'settlement-service',
    group_name: 'mongo',
    key: 'db',
    value: 'settlement',
  },
  // The broker earns its place twice over here: the relay publishes
  // `settlement.run.completed`, and **two** subscriptions feed the fold —
  // `order.placed` for the vendor-tagged lines and the channel, and
  // `payment.captured` for the money and its timestamp (ADR 0057).
  {
    service: 'settlement-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'settlement-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
  {
    service: 'settlement-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'settlement-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // The vendor whose agreement the lab seeds — the same id auth-service seeds
  // the `Organization` under. ⚠️ Without an agreement on file the fold prices
  // nothing and logs, deliberately: there is no default commission in this
  // system, only a default *within* an agreement, and guessing one would put a
  // term nobody negotiated into a ledger built to be defensible in a dispute.
  {
    service: 'settlement-service',
    group_name: 'tenant',
    key: 'demoOrganizationId',
    value: 'demo-organization',
  },
  // ⚠️ **No `service.token` row, and the omission is deliberate.** This slice
  // holds no crossing token and accepts none: both of its inputs arrive on the
  // bus, so nothing dispatches into it, and every route it serves is guarded by
  // a verified session. A secret it never reads would be a fourth holder of a
  // credential that can name any organization (ADR 0023).
  // How often the sweep folds unsettled commission entries into payouts. Five
  // minutes in the lab: long enough that the log is readable, short enough that
  // a period settles while you are still looking at it. A live pass does not
  // wait for it — `POST /api/settlement-run` runs the same pass on demand.
  {
    service: 'settlement-service',
    group_name: 'settlement',
    key: 'runIntervalMs',
    value: '300000',
  },
  {
    service: 'settlement-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'settlement-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'settlement-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'settlement-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // marketplace-service — the storefront's platform-plane read host. It owns the
  // `catalog-reference` and `published-catalog` stores, both `single`, so unlike
  // the admin service it names a database at boot rather than resolving one per
  // request from the session.
  {
    service: 'marketplace-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'marketplace-service',
    group_name: 'mongo',
    key: 'db',
    value: 'marketplace',
  },
  // The bus this service **consumes** from: it subscribes `catalog.*` and
  // writes the `published-catalog` projection. Same broker as the admin
  // service's, which is what makes them one exchange rather than two fleets.
  {
    service: 'marketplace-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  // The public half only. This service verifies access tokens and never mints
  // one, so it cannot sign.
  {
    service: 'marketplace-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'marketplace-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  {
    service: 'marketplace-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'marketplace-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'marketplace-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  // How often the metric reader pushes to the Collector. The endpoint above is
  // the destination; this is the only dial on the metric half, and it is a row
  // rather than a constant so resolution can be traded against export volume
  // without a rebuild.
  {
    service: 'marketplace-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // stock-service — physical availability, per vendor. Tenant plane and
  // per-organization, so like marketplace-admin-service it resolves a database
  // handle inside the request and names none at boot: `mongo.db` is absent on
  // purpose, because a database named here is one nothing would ever write.
  {
    service: 'stock-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  // ⚠️ **`stock_`, not `tenant_`.** The `stock` and `catalog` stores share a
  // plane, a partitioning and an engine; the only thing that keeps them apart
  // is the prefix each service's tenant resolver is built with. Copying the
  // catalog's value here would merge two stores into one database silently —
  // every read would work and every write would land, and two domains would own
  // one database, which is the coupling the decomposition exists to prevent.
  {
    service: 'stock-service',
    group_name: 'tenant',
    key: 'dbPrefix',
    value: 'stock_',
  },
  // The same demo vendor the catalog is seeded under, for the same reason it is
  // configuration in the two rows above rather than a constant: three services
  // now have to agree on the id, and this one seeds its stock positions against
  // offerings marketplace-admin-service wrote.
  //
  // ⚠️ **A different database, though.** `tenant.dbPrefix` above is what keeps
  // `stock_<id>` and `tenant_<id>` apart; this row only names the organization,
  // so the two stores stay separate stores with separate writers.
  {
    service: 'stock-service',
    group_name: 'tenant',
    key: 'demoOrganizationId',
    value: 'demo-organization',
  },
  // The public half only. This service verifies access tokens and never mints
  // one, so it cannot sign.
  {
    service: 'stock-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'stock-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **The crossing secret, and deliberately not `CONFIG_SERVICE_TOKEN`.**
  // The fleet's config token gates a configuration *read*; this one gates a
  // tenant-data *write* for any organization the caller names. Reusing the first
  // would have been one line and would have made a single leaked secret a
  // cross-organization write capability, so they are separate keys with
  // separate rotations
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  //
  // `is_secret` is the boundary rather than a label: an unflagged row is served
  // in full from the unauthenticated `GET /api/config` every service mounts.
  {
    service: 'stock-service',
    group_name: 'service',
    key: 'token',
    value: 'dev-stock-crossing-token-change-me',
    is_secret: true,
  },
  // How long a hold survives without being converted or released. A business
  // trade rather than a constant — too short and a buyer loses their basket
  // mid-payment, too long and stock sits promised to a checkout nobody
  // finished — so it lives where an operator can tune it against a real payment
  // provider's latency.
  {
    service: 'stock-service',
    group_name: 'reservation',
    key: 'ttlSeconds',
    value: '900',
  },
  {
    service: 'stock-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'stock-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'stock-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'stock-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
  },
  // sales-service — how a vendor sells, per vendor. Tenant plane and
  // per-organization, so like stock-service it resolves a database handle inside
  // the request and names none at boot: `mongo.db` is absent on purpose.
  {
    service: 'sales-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  // ⚠️ **`sales_`, and now there are three.** `catalog`, `stock` and `sales`
  // share a plane, a partitioning and an engine, and the only thing keeping them
  // in three databases is the prefix each service's tenant resolver is built
  // with. A copied prefix merges two stores silently — every read works, every
  // write lands, and two domains own one database.
  {
    service: 'sales-service',
    group_name: 'tenant',
    key: 'dbPrefix',
    value: 'sales_',
  },
  // The same demo vendor the catalog and the stock positions are seeded under.
  // ⚠️ A lab with no channel cannot ring up a counter sale at all: the till asks
  // for one and `POST /api/counter-sale` refuses without it.
  {
    service: 'sales-service',
    group_name: 'tenant',
    key: 'demoOrganizationId',
    value: 'demo-organization',
  },
  // The public half only. This service verifies access tokens and never mints
  // one, so it cannot sign.
  {
    service: 'sales-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'sales-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // Where the checkout coordinator answers, and the secret this service
  // presents to start a flow through it.
  //
  // ⚠️ **The coordinator's *inbound* token, not a participant's.** It starts a
  // saga; it does not write a vendor's stock or an order — transaction-service
  // holds those separately, so a leak here cannot reach a tenant store directly
  // (ADR 0023). It is the same secret the storefront's checkout action presents,
  // and this is the second holder: the storefront holds it because it has no
  // session to check, this service because it checks one first (ADR 0056).
  {
    service: 'sales-service',
    group_name: 'transaction',
    key: 'url',
    value: 'http://localhost:3103/api',
  },
  {
    service: 'sales-service',
    group_name: 'transaction',
    key: 'crossingToken',
    value: 'dev-saga-crossing-token-change-me',
    is_secret: true,
  },
  // The published projection a counter sale is priced from. Anonymous, because
  // the projection is: `published-catalog` is platform plane and marketplace-
  // service serves it to nobody in particular.
  {
    service: 'sales-service',
    group_name: 'marketplace',
    key: 'url',
    value: 'http://localhost:3100/api',
  },
  {
    service: 'sales-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'sales-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'sales-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'sales-service',
    group_name: 'otel',
    key: 'metricIntervalMs',
    value: '60000',
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
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
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
 * The service's composition root: the database (migrated and seeded), its
 * readiness probe, and the auth services the guarded CRUD routes need.
 */
export const AppLayer = Layer.provideMerge(
  Layer.mergeAll(SqlHealthProbeLayer(['configuration']), AuthLive),
  DbLive,
).pipe(Layer.orDie);
