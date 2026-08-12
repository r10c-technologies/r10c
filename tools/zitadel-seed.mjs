#!/usr/bin/env node
/**
 * Give a freshly-initialised Zitadel instance everything the r10c fleet expects
 * to find in it: a project, the OIDC app auth-app signs in through, the v2
 * hosted login and where to find it, the Actions v2 target that tells us a user
 * was deactivated, TOTP as an available second factor, SMTP pointed at Mailpit,
 * and — only when credentials are present — a Google identity provider.
 *
 * Run by the L7 rung of `infra/local/ensure.sh` (and again at the end of
 * `reset.sh`), never by hand in a normal workflow. It is **idempotent**: every
 * step looks for what it would create before creating it, because the ladder
 * may re-run it after a partial failure and a duplicate OIDC app would hand out
 * a second client id that nothing is configured to use.
 *
 * What it deliberately does NOT do is create human users. Those are provisioned
 * by auth-service through the same code path the back office uses, so the seed
 * exercises the real path instead of a parallel one that could drift from it.
 *
 * Reads `ZITADEL_PAT_FILE`, `ZITADEL_ISSUER`, `ZITADEL_GENERATED_ENV` from the
 * environment; the ladder supplies all three.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

const ISSUER = process.env['ZITADEL_ISSUER'] ?? 'http://localhost:30080';
const PAT_FILE =
  process.env['ZITADEL_PAT_FILE'] ??
  join(REPO_ROOT, 'infra/local/zitadel/.pat');
const GENERATED_ENV =
  process.env['ZITADEL_GENERATED_ENV'] ??
  join(REPO_ROOT, 'infra/local/zitadel/.generated.env');
const ZITADEL_ENV = join(REPO_ROOT, 'infra/local/zitadel/.env');

/** The project and app names the seed reconciles against, on both runs. */
const PROJECT_NAME = 'r10c';
const APP_NAME = 'r10c-web';

/**
 * Bumped whenever this file starts configuring something new. `infra/local/lib.sh`
 * owns the value and passes it in; it is stamped into `.generated.env` so the
 * ladder's L7 guard can tell "seeded" from "seeded by an older version of this
 * script" — which is the difference between a new setting reaching every
 * machine and reaching only the ones that happened to reset.
 */
const SEED_REVISION = process.env['ZITADEL_SEED_REVISION'] ?? '0';

/**
 * auth-app owns the browser-facing edge, so the OIDC round trip lands there and
 * nowhere else. One redirect URI covers the whole fleet: dev cookies are
 * host-scoped and `localhost` shares them across ports, so :3000 and :3001 see
 * the session :3002 established.
 */
const REDIRECT_URIS = ['http://localhost:3002/api/auth/callback'];
const POST_LOGOUT_URIS = ['http://localhost:3002/'];

/**
 * Where Zitadel POSTs a logout token when a session it owns ends. Note the host:
 * unlike the two above this one is **not** browser-facing. Zitadel calls it
 * server-to-server from inside minikube, so `localhost` would be the pod itself;
 * `host.minikube.internal` is the node's route back out to the machine running
 * auth-service. Overridable for a cluster whose gateway is named differently.
 */
const BACK_CHANNEL_LOGOUT_URI =
  process.env['ZITADEL_BACKCHANNEL_LOGOUT_URI'] ??
  'http://host.minikube.internal:3102/api/auth/backchannel-logout';

/**
 * Where Zitadel POSTs a user-lifecycle event. Same host reasoning as the
 * back-channel URI above, and the same `HTTPClient.DenyList` carve-out covers
 * it: the denylist governs Actions v2 targets and back-channel logout alike.
 */
const PROVIDER_EVENTS_URI =
  process.env['ZITADEL_PROVIDER_EVENTS_URI'] ??
  'http://host.minikube.internal:3102/api/auth/provider-events';

/** The Actions v2 target this seed reconciles, and the events routed to it. */
const ACTION_TARGET_NAME = 'r10c-user-lifecycle';
const ACTION_EVENTS = ['user.deactivated', 'user.locked', 'user.removed'];

/**
 * Where the browser is sent to actually sign in. Browser-facing, so `localhost`
 * — and its own NodePort, because the login is a separate container serving a
 * separate origin rather than a path on Zitadel's. Zitadel appends its own
 * suffixes to this base (`login?authRequest=`, `logout?post_logout_redirect=`),
 * hence the trailing slash. It must agree with `NEXT_PUBLIC_BASE_PATH` and the
 * NodePort in `infra/local/zitadel-login/`.
 */
const LOGIN_BASE_URI =
  process.env['ZITADEL_LOGIN_BASE_URI'] ??
  'http://localhost:30081/ui/v2/login/';

const pat = readFileSync(PAT_FILE, 'utf8').trim();

const log = message => console.log(`  ${message}`);

/**
 * One API call. Zitadel answers `200` with a JSON error body for some failures
 * and a real status for others, so both are folded into one thrown Error —
 * a silent half-seeded instance is worse than a loud stop.
 */
const api = async (method, path, body) => {
  const response = await fetch(`${ISSUER}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${pat}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const payload = text === '' ? {} : JSON.parse(text);
  if (!response.ok) {
    const error = new Error(
      `${method} ${path} -> ${response.status} ${payload.message ?? text}`,
    );
    error.zitadelId = payload.details?.[0]?.id ?? '';
    error.zitadelMessage = payload.message ?? '';
    throw error;
  }
  return payload;
};

/** A conflict is success here: the seed's whole job is to converge on a state. */
const alreadyExists = error =>
  /AlreadyExists/i.test(error.zitadelMessage ?? '') ||
  /already exists/i.test(error.message);

/** Read a `KEY=value` out of a `KEY=value` file, or `''` if either is missing. */
const readKeyFrom = (file, key) => {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    return '';
  }
  const line = contents
    .split('\n')
    .find(candidate => candidate.startsWith(`${key}=`));
  return line === undefined ? '' : line.slice(key.length + 1).trim();
};

// ---------------------------------------------------------------- project

const ensureProject = async () => {
  const found = await api('POST', '/management/v1/projects/_search', {
    queries: [
      {
        nameQuery: { name: PROJECT_NAME, method: 'TEXT_QUERY_METHOD_EQUALS' },
      },
    ],
  });
  const existing = (found.result ?? [])[0];
  if (existing !== undefined) {
    log(`project "${PROJECT_NAME}" already present (${existing.id})`);
    return existing.id;
  }
  const created = await api('POST', '/management/v1/projects', {
    name: PROJECT_NAME,
  });
  log(`project "${PROJECT_NAME}" created (${created.id})`);
  return created.id;
};

// ---------------------------------------------------------------- oidc app

/**
 * A **public** client: `OIDC_AUTH_METHOD_TYPE_NONE` means no client secret, and
 * PKCE is what secures the exchange instead. That is the right shape even though
 * auth-service performs the exchange server-side — a secret we would have to
 * distribute through config-service buys nothing PKCE does not already give,
 * and one fewer credential in the fleet is one fewer to leak.
 *
 * `devMode: true` is what lets Zitadel accept the plain-HTTP `localhost`
 * redirect. It is a local-lab affordance and has no production counterpart.
 */
const oidcConfigBody = () => ({
  redirectUris: REDIRECT_URIS,
  postLogoutRedirectUris: POST_LOGOUT_URIS,
  responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
  grantTypes: [
    'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
    'OIDC_GRANT_TYPE_REFRESH_TOKEN',
  ],
  appType: 'OIDC_APP_TYPE_WEB',
  authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
  devMode: true,
  accessTokenType: 'OIDC_TOKEN_TYPE_BEARER',
  backChannelLogoutUri: BACK_CHANNEL_LOGOUT_URI,
});

const ensureApp = async projectId => {
  const found = await api(
    'POST',
    `/management/v1/projects/${projectId}/apps/_search`,
    { query: { limit: 100 } },
  );
  const existing = (found.result ?? []).find(app => app.name === APP_NAME);
  if (existing?.oidcConfig?.clientId !== undefined) {
    // Reconcile rather than return: this function used to be create-only, so a
    // field added to the body below would never have reached an instance that
    // was seeded before it existed. Zitadel's update is a full replace, which is
    // why create and update share one body — two copies would drift the moment
    // one of them gained a setting.
    if (existing.oidcConfig.backChannelLogoutUri !== BACK_CHANNEL_LOGOUT_URI) {
      await api(
        'PUT',
        `/management/v1/projects/${projectId}/apps/${existing.id}/oidc_config`,
        oidcConfigBody(),
      );
      log(`oidc app "${APP_NAME}" back-channel logout URI updated`);
    }
    log(
      `oidc app "${APP_NAME}" already present (${existing.oidcConfig.clientId})`,
    );
    return existing.oidcConfig.clientId;
  }

  const created = await api(
    'POST',
    `/management/v1/projects/${projectId}/apps/oidc`,
    { name: APP_NAME, ...oidcConfigBody() },
  );
  log(`oidc app "${APP_NAME}" created (${created.clientId})`);
  return created.clientId;
};

// ----------------------------------------------------------- login version

/**
 * Point the instance at the **v2** hosted login, and require it.
 *
 * The v2 login is a *separate* Next.js service (`ghcr.io/zitadel/zitadel-login`)
 * that the core image does not serve, which is the whole hazard here: with the
 * feature on and nothing serving `/ui/v2/login`, every authorization redirect
 * answers **404** while `/debug/ready` stays green — a broken sign-in button
 * behind a healthy fleet. That container is `infra/local/zitadel-login`, and the
 * ladder brings it up at L6, one rung *before* this seed runs at L7, precisely so
 * the switch is never flipped towards an address that answers nothing.
 *
 * `baseUri` is a browser-facing URL on its own origin (`localhost:30081`) rather
 * than a path on Zitadel's. Upstream's compose puts both behind one domain with
 * Traefik; that would cost this lab a reverse-proxy workload and h2c passthrough
 * for Zitadel's gRPC, and buy nothing — `localhost` cookies ignore the port, so
 * the two origins already share a jar. Zitadel derives the login and logout URLs
 * it redirects to by appending to this base.
 *
 * Reconciled on `baseUri`, not merely on `required`: an instance seeded before
 * the port moved would otherwise keep the old address forever, which is the same
 * trap `ensureApp` fell into with `backChannelLogoutUri`.
 */
const ensureLoginV2 = async () => {
  const features = await api('GET', '/v2/features/instance');
  const current = features?.loginV2;
  if (current?.required === true && current?.baseUri === LOGIN_BASE_URI) {
    log(`login version: v2 already in use (${LOGIN_BASE_URI})`);
    return;
  }
  await api('PUT', '/v2/features/instance', {
    loginV2: { required: true, baseUri: LOGIN_BASE_URI },
  });
  log(`login version: v2 required, served from ${LOGIN_BASE_URI}`);
};

// ----------------------------------------------------------- actions v2

/**
 * The webhook that makes a *user* ending propagate, not just a session ending.
 *
 * Zitadel fires a back-channel logout token when a session it owns ends, and
 * **nothing at all** when a user is deactivated — measured, and the reason issue
 * #52 stayed open after back-channel logout shipped. An Actions v2 event
 * execution is the seam that closes it: three events, one target, auth-service
 * revokes the subject's sessions.
 *
 * `restAsync` because Zitadel must not wait on us — the response is ignored, and
 * a slow auth-service must never slow a deactivation down. `PAYLOAD_TYPE_JSON`
 * pairs the body with an HMAC in `ZITADEL-Signature`, which is that endpoint's
 * only authentication.
 *
 * **The signing key is the whole difficulty.** Zitadel mints it inside
 * `CreateTarget` and never serves it again — there is no read-back and no
 * rotate-in-place — while config-service's seed is `ON CONFLICT DO NOTHING`, so
 * a key that changed here would never reach the Postgres row that auth-service
 * reads. The webhook would then reject every call, silently, and the bug would
 * look unfixed. Hence: carry the key forward from the previous `.generated.env`
 * whenever the target still exists, and only mint a new one when there is no
 * target to match it. Both halves are recreated together by `dev:reset`, which
 * is what makes that pairing safe.
 */
const ensureActionTarget = async () => {
  const found = await api('POST', '/v2/actions/targets/search', {
    filters: [
      {
        targetNameFilter: {
          targetName: ACTION_TARGET_NAME,
          method: 'TEXT_FILTER_METHOD_EQUALS',
        },
      },
    ],
  });
  const existing = (found.targets ?? []).find(
    target => target.name === ACTION_TARGET_NAME,
  );
  const knownKey = readKeyFrom(GENERATED_ENV, 'ZITADEL_ACTION_SIGNING_KEY');

  if (existing !== undefined && knownKey !== '') {
    // Reconcile rather than return, for the same reason `ensureApp` does: a
    // field added to the body below must reach an instance seeded before it
    // existed. The update leaves the signing key alone.
    if (existing.endpoint !== PROVIDER_EVENTS_URI) {
      await api('POST', `/v2/actions/targets/${existing.id}`, {
        name: ACTION_TARGET_NAME,
        restAsync: {},
        endpoint: PROVIDER_EVENTS_URI,
        timeout: '10s',
      });
      log(`action target "${ACTION_TARGET_NAME}" endpoint updated`);
    } else {
      log(`action target "${ACTION_TARGET_NAME}" already present`);
    }
    return { targetId: existing.id, signingKey: knownKey };
  }

  if (existing !== undefined) {
    // The target outlived the file that held its key, so the key is gone for
    // good and the only way back to a working pair is a new target.
    await api('DELETE', `/v2/actions/targets/${existing.id}`);
    log(
      `action target "${ACTION_TARGET_NAME}" recreated: its signing key was lost`,
    );
  }

  const created = await api('POST', '/v2/actions/targets', {
    name: ACTION_TARGET_NAME,
    restAsync: {},
    endpoint: PROVIDER_EVENTS_URI,
    timeout: '10s',
    payloadType: 'PAYLOAD_TYPE_JSON',
  });
  if (typeof created.signingKey !== 'string' || created.signingKey === '') {
    // Without it the webhook fails closed and every deactivation is silently
    // not propagated — worth stopping the seed over.
    throw new Error('the action target was created without a signing key');
  }
  log(`action target "${ACTION_TARGET_NAME}" created (${created.id})`);
  return { targetId: created.id, signingKey: created.signingKey };
};

/**
 * Route the three user-lifecycle events at the target. `SetExecution` is a
 * write of the whole condition→targets mapping, so re-running it converges by
 * construction and needs no search-then-create dance.
 */
const ensureExecutions = async targetId => {
  for (const event of ACTION_EVENTS) {
    await api('PUT', '/v2/actions/executions', {
      condition: { event: { event } },
      targets: [targetId],
    });
  }
  log(`action executions: ${ACTION_EVENTS.join(', ')} -> ${targetId}`);
};

// ------------------------------------------------------------ login policy

/**
 * TOTP is made **available**, never required: `forceMfa` stays off so seeded
 * users keep signing in unattended and the e2e suites stay scriptable. A fresh
 * instance already ships OTP as a second factor, hence the tolerated conflict.
 */
const ensureLoginPolicy = async () => {
  try {
    await api('POST', '/admin/v1/policies/login/second_factors', {
      type: 'SECOND_FACTOR_TYPE_OTP',
    });
    log('login policy: TOTP enabled as a second factor');
  } catch (error) {
    if (!alreadyExists(error)) throw error;
    log('login policy: TOTP already available');
  }

  const { policy } = await api('GET', '/admin/v1/policies/login');
  if (policy?.allowRegister !== true) {
    // Self-registration is how a storefront buyer gets an account at all, so a
    // policy without it is a broken fleet rather than a preference.
    throw new Error(
      'login policy has allowRegister=false — buyers could not create accounts',
    );
  }
  if (policy?.forceMfa === true) {
    log('WARNING: forceMfa is on; every sign-in will demand a second factor');
  }
};

// -------------------------------------------------------------------- smtp

/**
 * A provider is created **inactive**, which is the trap: everything looks
 * configured, the console shows the host, and not one mail is ever delivered.
 * The activate call is the step that matters.
 */
const ensureSmtp = async () => {
  const found = await api('POST', '/admin/v1/smtp/_search', {
    query: { limit: 100 },
  });
  const existing = (found.result ?? []).find(
    config => config.host === 'mailpit:1025',
  );
  const id =
    existing?.id ??
    (
      await api('POST', '/admin/v1/smtp', {
        senderAddress: 'no-reply@r10c.local',
        senderName: 'r10c (local)',
        host: 'mailpit:1025',
        user: '',
        password: '',
        tls: false,
        description: 'Mailpit (local dev)',
      })
    ).id;

  if (existing?.state === 'SMTP_CONFIG_ACTIVE') {
    log('smtp: Mailpit already active');
    return;
  }
  await api('POST', `/admin/v1/smtp/${id}/_activate`, {});
  log('smtp: Mailpit configured and activated');
};

// --------------------------------------------------------------------- idp

/** Read a KEY=value out of the platform's untracked `.env`, if it has one. */
const readEnvValue = key => readKeyFrom(ZITADEL_ENV, key);

/**
 * Social sign-in is wired only when a developer has supplied real credentials.
 * Skipping is a first-class outcome, not a failure: OAuth credentials cannot be
 * committed, and password + TOTP sign-in does not depend on them.
 */
const ensureGoogleIdp = async () => {
  const clientId = readEnvValue('R10C_GOOGLE_CLIENT_ID');
  const clientSecret = readEnvValue('R10C_GOOGLE_CLIENT_SECRET');
  if (clientId === '' || clientSecret === '') {
    log('google idp: skipped (no credentials in infra/local/zitadel/.env)');
    return;
  }

  const found = await api('POST', '/admin/v1/idps/templates/_search', {
    query: { limit: 100 },
  });
  const existing = (found.result ?? []).find(idp => idp.name === 'Google');
  if (existing !== undefined) {
    log(`google idp: already present (${existing.id})`);
    return;
  }

  const created = await api('POST', '/admin/v1/idps/google', {
    name: 'Google',
    clientId,
    clientSecret,
    scopes: ['openid', 'profile', 'email'],
    providerOptions: {
      isLinkingAllowed: true,
      isCreationAllowed: true,
      isAutoCreation: true,
      isAutoUpdate: true,
    },
  });
  // Creating the provider is not the same as offering it: without this the
  // button never appears on the hosted login page.
  await api('POST', '/admin/v1/policies/login/idps', {
    idpId: created.id,
    ownerType: 'IDP_OWNER_TYPE_SYSTEM',
  });
  log(`google idp: created and added to the login policy (${created.id})`);
};

// -------------------------------------------------------------------- main

const main = async () => {
  const projectId = await ensureProject();
  const clientId = await ensureApp(projectId);
  await ensureLoginV2();
  const { targetId, signingKey } = await ensureActionTarget();
  await ensureExecutions(targetId);
  await ensureLoginPolicy();
  await ensureSmtp();
  await ensureGoogleIdp();

  // Written last, and only on success: `zitadel_seeded()` treats this file as
  // proof the instance is ready, so writing it early would let a failed run
  // convince the next boot there was nothing to do.
  writeFileSync(
    GENERATED_ENV,
    [
      '# Generated by tools/zitadel-seed.mjs — do not edit, do not commit.',
      '# Regenerated from scratch whenever the Zitadel instance is recreated.',
      `ZITADEL_ISSUER=${ISSUER}`,
      `ZITADEL_PROJECT_ID=${projectId}`,
      `ZITADEL_CLIENT_ID=${clientId}`,
      `ZITADEL_PAT=${pat}`,
      // Read back by the next run of this seed, not only by config-service:
      // Zitadel never serves a target's signing key twice, so this file is the
      // only place it survives a re-seed. See `ensureActionTarget`.
      `ZITADEL_ACTION_SIGNING_KEY=${signingKey}`,
      // The ladder's L7 guard reads this back. It is what makes the guard a
      // cache key rather than a "has this ever run" flag — see `lib.sh`.
      `ZITADEL_SEED_REVISION=${SEED_REVISION}`,
      '',
    ].join('\n'),
    { mode: 0o600 },
  );
  log(`wrote ${GENERATED_ENV}`);
};

main().catch(error => {
  console.error(`ERROR: zitadel seed failed: ${error.message}`);
  process.exit(1);
});
