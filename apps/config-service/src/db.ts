import { readFileSync } from 'node:fs';

import type { ConfigurationRow } from '@r10c/shells-effect-config';

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
 *
 * ⚠️ The pairing holds only if the file names the running instance, and a reset
 * made from another checkout breaks that: the file is per checkout, the
 * instance is not. The ladder's L7 rung is what guarantees it before this boots
 * — it asks Zitadel whether the file's token is accepted and restores a
 * rejected copy from the cluster (#280).
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

/**
 * The services that boot through `makeFleetServiceLayer`, and so build a retry
 * budget from their own `retry` rows. config-service is not one: it serves the
 * rows and retries nothing.
 */
const FLEET_SERVICES = [
  'auth-service',
  'marketplace-service',
  'marketplace-admin-service',
  'transaction-service',
  'order-service',
  'payment-service',
  'settlement-service',
  'stock-service',
  'sales-service',
  'fulfilment-service',
  'realtime-service',
] as const;

/**
 * The in-process retry budget, ADR 0064 and entifix ADR 0014: three attempts
 * at most, a tenth of the load as retries plus a floor so a quiet dependency
 * can still retry once, full-jitter backoff, and client-side throttling past
 * two requests per accept over two minutes. Rows rather than defaults so a live
 * pass can tighten a dial without a rebuild; a missing row keeps entifix's
 * default (`readRetryDials`).
 *
 * ⚠️ These size the shell's **in-process** retries only. A bus consumer never
 * retries in process — redelivery is its retry — and its ceiling is the
 * subscription's own `maxAttempts`, which the slices register holds to the
 * fleet delivery budget of 5.
 */
const RETRY_DIALS: Readonly<Record<string, string>> = {
  maxAttempts: '3',
  budgetRatio: '0.1',
  budgetFloorPerSecond: '1',
  backoffBaseMs: '50',
  backoffCapMs: '2000',
  adaptiveThrottlingK: '2',
  adaptiveThrottlingWindowMs: '120000',
};

const RETRY_ROWS: ReadonlyArray<ConfigurationRow> = FLEET_SERVICES.flatMap(
  service =>
    Object.entries(RETRY_DIALS).map(([key, value]) => ({
      service,
      group_name: 'retry',
      key,
      value,
    })),
);

/**
 * The participants the flow engine calls (ADR 0067), each with a breaker, a
 * bulkhead and step bounds of its own — a payment provider and a stock ledger
 * do not fail, or answer, on the same clock. `db.spec.ts` fails a seed missing
 * a dial for any participant a registered fragment names.
 */
const FLOW_PARTICIPANTS = [
  'stock-service',
  'order-service',
  'payment-service',
  'fulfilment-service',
] as const;

/**
 * ADR 0067's defaults. The two rates are percentages, as the ADR states them.
 * `forcedState` is an operator's override applied at boot: `closed` leaves the
 * breaker to its window, `forcedOpen` refuses every call, `disabled` lets every
 * call through unrecorded.
 */
const PARTICIPANT_DIALS: Readonly<Record<string, string>> = {
  windowType: 'count',
  windowSize: '20',
  minimumCalls: '5',
  failureRateThreshold: '50',
  slowCallThresholdMs: '2000',
  slowCallRate: '80',
  waitInOpenMs: '10000',
  halfOpenPermits: '3',
  forcedState: 'closed',
  bulkheadPermits: '16',
  attemptTimeoutMs: '5000',
  stepBoundMs: '60000',
};

const PARTICIPANT_DIAL_ROWS: ReadonlyArray<ConfigurationRow> =
  FLOW_PARTICIPANTS.flatMap(participant =>
    Object.entries(PARTICIPANT_DIALS).map(([dial, value]) => ({
      service: 'transaction-service',
      group_name: 'breaker',
      key: `${participant}.${dial}`,
      value,
    })),
  );

export const SEED_ROWS: ReadonlyArray<ConfigurationRow> = [
  // Locale policy, per frontend. `default` is what an unprefixed URL negotiates
  // to when the visitor has no cookie and their `Accept-Language` names nothing
  // we speak; `supported` is the set the proxy will honour in a path
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
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'marketplace-admin-service-domain',
    value: 'http://localhost:3101/api',
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
  // fulfilment-service, a vendor's shipments and the dispatch worklist. Tenant
  // plane: the service resolves the viewer's organization from the session.
  // Rewritten to `/api/fulfilment` before the browser sees it — and, as above,
  // the proxy entry is inert without this row.
  {
    service: 'back-office-app',
    group_name: 'uri',
    key: 'fulfilment-service-domain',
    value: 'http://localhost:3110/api',
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
  // out.
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
  {
    service: 'auth-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  { service: 'auth-service', group_name: 'mongo', key: 'db', value: 'auth' },
  // The bus an organization's announcement leaves on, from the outbox in the
  // `auth` store (ADR 0061). Same broker and same quarantine budget as every
  // other publishing slice.
  {
    service: 'auth-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'auth-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
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
  // How long an access token lives (ADR 0004). Short on purpose — it bounds how
  // long a revoked session keeps working, since verification never consults the
  // store — and a dial rather than a constant so a live pass can shorten it and
  // watch a push stream reauthenticate before `exp` (#492). The browser follows
  // whatever this mints: every refresh answers the new token's `expiresIn`, and
  // the next refresh is scheduled from it. It must stay well above realtime's
  // `reauthMarginMs`; auth-service refuses to boot under 60 s.
  {
    service: 'auth-service',
    group_name: 'session',
    key: 'accessTokenTtlSeconds',
    value: '900',
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
  // The bus marketplace-admin-service announces its catalog on.
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
  // transaction-service — the flow coordinator. It owns the `workflow` store
  // (Postgres, below) and no Mongo store: a start's idempotency is the
  // engine's own registration of its `Idempotency-Key` (ADR 0066).
  // The published vendor projection, read for what each vendor a flow acts
  // for is provisioned for: the coordinator states a vendor segment's
  // entitlements itself rather than take the caller's word for them.
  {
    service: 'transaction-service',
    group_name: 'marketplace',
    key: 'url',
    value: 'http://localhost:3100/api',
  },
  {
    service: 'transaction-service',
    group_name: 'amqp',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  // The durable flow engine's store (ADR 0066): one Postgres database holding
  // every flow's journal, the runners' registrations and shard locks, each
  // flow's status and the outbox its announcements leave through. Created by
  // the infra ladder's L5c rung, beside Zitadel's on the same instance.
  {
    service: 'transaction-service',
    group_name: 'workflow',
    key: 'url',
    value: 'postgres://postgres:postgres@127.0.0.1:30432/workflow',
    is_secret: true,
  },
  // Where the other runners reach this one. Each replica listens on its own
  // port — the service port + 31000 + 1000 × its index — and registers this
  // host with it.
  {
    service: 'transaction-service',
    group_name: 'workflow',
    key: 'runnerHost',
    value: '127.0.0.1',
  },
  // How many segments of one stage a flow runs at once — a basket's per-vendor
  // holds, before the shared pivot.
  {
    service: 'transaction-service',
    group_name: 'flow',
    key: 'concurrency',
    value: '4',
  },
  // How long a delivery flow waits, in milliseconds (ADR 0070): fourteen days
  // for the courier's report — none in the window is handled as a refusal —
  // and thirty for a refused parcel to come back, after which the flow strands
  // for a person. Stated into every delivery by the coordinator, never by the
  // caller that starts it.
  {
    service: 'transaction-service',
    group_name: 'delivery',
    key: 'awaitDeliveryTimeout',
    value: String(14 * 24 * 60 * 60 * 1000),
  },
  {
    service: 'transaction-service',
    group_name: 'delivery',
    key: 'awaitReturnTimeout',
    value: String(30 * 24 * 60 * 60 * 1000),
  },
  // The flow engine's announcements leave through the workflow store's own
  // outbox, under the same quarantine ceiling as every other relay.
  {
    service: 'transaction-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
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
    value: 'dev-flow-crossing-token-change-me',
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
    group_name: 'participant',
    key: 'fulfilmentUrl',
    value: 'http://localhost:3110',
  },
  {
    service: 'transaction-service',
    group_name: 'participant',
    key: 'fulfilmentToken',
    value: 'dev-fulfilment-crossing-token-change-me',
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
  // How long a crossing write's `Idempotency-Key` replays its first answer
  // (ADR 0068): past it the key is free again. A day outlasts every redelivery
  // and every coordinator retry.
  {
    service: 'order-service',
    group_name: 'idempotency',
    key: 'retentionMs',
    value: '86400000',
  },
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
  // ⚠️ **This number and the storefront's `RECEIPT_TTL_SECONDS` are one
  // number.** The receipt cookie is the only place the buyer's cancel nonce
  // lives, so a window wider than the cookie is a capability nobody can present
  // and a cookie that outlives the window is a Cancel button that quietly stops
  // working. 30 minutes, matching that constant
  // ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md)).
  //
  // Not `is_secret`: it is a dial, not a credential, and an operator narrowing
  // a cancel window should be able to read what it is today.
  {
    service: 'order-service',
    group_name: 'order',
    key: 'cancelWindowSeconds',
    value: '1800',
  },
  // Where the cancellation coordinator answers, and the secret this service
  // presents to start a flow through it.
  //
  // ⚠️ **The coordinator's *inbound* token, deliberately not the `service.token`
  // row above.** That one is what transaction-service presents *to* this process
  // when it dispatches a step; this is what this process presents *to*
  // transaction-service to start one. One shared value would mean anyone allowed
  // to write an order also held the key that starts any flow in the fleet
  // ([ADR 0023](../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
  //
  // This makes order-service the **third** holder of that secret, beside the
  // storefront and sales-service — and unlike either of those it is also a
  // participant in the flow it starts. The cycle is accepted in
  // [ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §6: a
  // cancellation's authority is a buyer's capability or a vendor's session, and
  // neither is verifiable anywhere but here.
  //
  // ⚠️ The value carries the `/api` suffix, matching sales-service's row and not
  // transaction-service's own `participant.*Url` rows, which do not. The route
  // composes `${url}/flow/<recipe>`.
  {
    service: 'order-service',
    group_name: 'transaction',
    key: 'url',
    value: 'http://localhost:3103/api',
  },
  {
    service: 'order-service',
    group_name: 'transaction',
    key: 'crossingToken',
    value: 'dev-flow-crossing-token-change-me',
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
  // How long a crossing write's `Idempotency-Key` replays its first answer
  // (ADR 0068): past it the key is free again. A day outlasts every redelivery
  // and every coordinator retry.
  {
    service: 'payment-service',
    group_name: 'idempotency',
    key: 'retentionMs',
    value: '86400000',
  },
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
  // checkout's compensation path** — forcing a refusal is the only way to prove the
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
  // Cash on delivery (ADR 0070). The most a courier is trusted to carry for one
  // vendor order — GTQ 1,500 in minor units, a business default seeded as a
  // dial — and the kill switch: `'true'` is the only value that turns it on.
  {
    service: 'payment-service',
    group_name: 'cod',
    key: 'maxAmount',
    value: '150000',
  },
  {
    service: 'payment-service',
    group_name: 'cod',
    key: 'enabled',
    value: 'true',
  },
  // The published vendor projection, read for whether a seller ships cash on
  // delivery: the same record the storefront offers it from.
  {
    service: 'payment-service',
    group_name: 'marketplace',
    key: 'url',
    value: 'http://localhost:3100/api',
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
  // fulfilment-service — a vendor order's journey to the buyer (ADR 0070). It
  // owns the `fulfilment` store: **tenant** plane, one database per
  // organization (`fulfilment_<organizationId>`), a fourth beside the
  // catalog's, stock's and sales'. ⚠️ The prefix is the only thing keeping it
  // apart from the other three, exactly as stock's is.
  {
    service: 'fulfilment-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'fulfilment-service',
    group_name: 'tenant',
    key: 'dbPrefix',
    value: 'fulfilment_',
  },
  // A move past dispatch announces itself from the organization's own outbox,
  // for the delivery flow that waits on it.
  {
    service: 'fulfilment-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'fulfilment-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
  {
    service: 'fulfilment-service',
    group_name: 'idempotency',
    key: 'retentionMs',
    value: '86400000',
  },
  {
    service: 'fulfilment-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'fulfilment-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **Its own crossing secret**, matching transaction-service's
  // `participant.fulfilmentToken` and no other service's (ADR 0023).
  {
    service: 'fulfilment-service',
    group_name: 'service',
    key: 'token',
    value: 'dev-fulfilment-crossing-token-change-me',
    is_secret: true,
  },
  // The coordinator, and its inbound token: a vendor's dispatch starts the
  // delivery flow there, which makes this service the fourth holder of that
  // secret, beside the storefront, sales-service and order-service (ADR 0070).
  {
    service: 'fulfilment-service',
    group_name: 'transaction',
    key: 'url',
    value: 'http://localhost:3103/api',
  },
  {
    service: 'fulfilment-service',
    group_name: 'transaction',
    key: 'crossingToken',
    value: 'dev-flow-crossing-token-change-me',
    is_secret: true,
  },
  {
    service: 'fulfilment-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'fulfilment-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'fulfilment-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'fulfilment-service',
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
  // The broker earns its place here because **two** subscriptions feed the
  // fold — `order.placed` for the vendor-tagged lines and the channel, and
  // `payment.captured` for the money and its timestamp (ADR 0057). Nothing is
  // published, so there is no outbox dial.
  {
    service: 'settlement-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
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
  // realtime-service — the push stream every tab opens through the edge, and
  // the `flow-status` projection a pending write catches up from (ADR 0072).
  // Platform plane, single: one database named at boot, written by this slice
  // alone.
  {
    service: 'realtime-service',
    group_name: 'mongo',
    key: 'uri',
    value: MONGO_URI,
    is_secret: true,
  },
  {
    service: 'realtime-service',
    group_name: 'mongo',
    key: 'db',
    value: 'flow_status',
  },
  // Every replica binds its own `broadcast` queues for what it pushes, so the
  // broker is the stream's only input besides the flow-status store.
  {
    service: 'realtime-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'realtime-service',
    group_name: 'jwt',
    key: 'publicKey',
    value: DEV_PUBLIC_KEY_PEM,
  },
  {
    service: 'realtime-service',
    group_name: 'jwt',
    key: 'keyId',
    value: DEV_KEY_ID,
  },
  // ⚠️ **No `service.token` row.** Nothing dispatches into this slice and it
  // dispatches nowhere: the stream and the flow reads answer the caller's own
  // session, or a flow capability compared by digest (ADR 0023).
  //
  // The SSE adapter's dials (ADR 0072). A drain sends each open stream a
  // `retry:` drawn from [retryMinMs, retryMaxMs], so a rolling restart spreads
  // its reconnects instead of landing them on one replica; a stream asks to
  // reauthenticate `reauthMarginMs` before its token's `exp`, which must stay
  // well inside the 15-minute access-token lifetime; a shutdown waits up to
  // `drainWindowMs` for the last frames to leave.
  {
    service: 'realtime-service',
    group_name: 'realtime',
    key: 'retryMinMs',
    value: '1000',
  },
  {
    service: 'realtime-service',
    group_name: 'realtime',
    key: 'retryMaxMs',
    value: '5000',
  },
  {
    service: 'realtime-service',
    group_name: 'realtime',
    key: 'reauthMarginMs',
    value: '30000',
  },
  {
    service: 'realtime-service',
    group_name: 'realtime',
    key: 'drainWindowMs',
    value: '5000',
  },
  // How long a flow's status stays readable after its last event — well past
  // the browser's 30-minute pending bound (ADR 0073), so a catch-up never
  // misses a flow that settled while its tab was closed.
  {
    service: 'realtime-service',
    group_name: 'realtime',
    key: 'flowStatusTtlS',
    value: '86400',
  },
  {
    service: 'realtime-service',
    group_name: 'logging',
    key: 'level',
    value: 'debug',
  },
  {
    service: 'realtime-service',
    group_name: 'logging',
    key: 'sink',
    value: 'otlp',
  },
  {
    service: 'realtime-service',
    group_name: 'otel',
    key: 'endpoint',
    value: 'http://127.0.0.1:30318',
  },
  {
    service: 'realtime-service',
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
  // How long a crossing write's `Idempotency-Key` replays its first answer
  // (ADR 0068): past it the key is free again. A day outlasts every redelivery
  // and every coordinator retry.
  // The broker and the outbox's dial: every counter move announces
  // `stock-item.changed` from its organization's own outbox (#481).
  {
    service: 'stock-service',
    group_name: 'rabbitmq',
    key: 'uri',
    value: 'amqp://admin:password@127.0.0.1:30672',
    is_secret: true,
  },
  {
    service: 'stock-service',
    group_name: 'outbox',
    key: 'maxAttempts',
    value: '5',
  },
  {
    service: 'stock-service',
    group_name: 'idempotency',
    key: 'retentionMs',
    value: '86400000',
  },
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
  // flow; it does not write a vendor's stock or an order — transaction-service
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
    value: 'dev-flow-crossing-token-change-me',
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
  ...RETRY_ROWS,
  ...PARTICIPANT_DIAL_ROWS,
];
