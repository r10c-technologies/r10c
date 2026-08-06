#!/usr/bin/env node
/**
 * Give a freshly-initialised Zitadel instance everything the r10c fleet expects
 * to find in it: a project, the OIDC app auth-app signs in through, TOTP as an
 * available second factor, SMTP pointed at Mailpit, and — only when credentials
 * are present — a Google identity provider.
 *
 * Run by the L6 rung of `infra/local/ensure.sh` (and again at the end of
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
 * auth-app owns the browser-facing edge, so the OIDC round trip lands there and
 * nowhere else. One redirect URI covers the whole fleet: dev cookies are
 * host-scoped and `localhost` shares them across ports, so :3000 and :3001 see
 * the session :3002 established.
 */
const REDIRECT_URIS = ['http://localhost:3002/api/auth/callback'];
const POST_LOGOUT_URIS = ['http://localhost:3002/'];

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
const ensureApp = async projectId => {
  const found = await api(
    'POST',
    `/management/v1/projects/${projectId}/apps/_search`,
    { query: { limit: 100 } },
  );
  const existing = (found.result ?? []).find(app => app.name === APP_NAME);
  if (existing?.oidcConfig?.clientId !== undefined) {
    log(`oidc app "${APP_NAME}" already present (${existing.oidcConfig.clientId})`);
    return existing.oidcConfig.clientId;
  }

  const created = await api(
    'POST',
    `/management/v1/projects/${projectId}/apps/oidc`,
    {
      name: APP_NAME,
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
    },
  );
  log(`oidc app "${APP_NAME}" created (${created.clientId})`);
  return created.clientId;
};

// ----------------------------------------------------------- login version

/**
 * Pin the instance to the **v1** hosted login.
 *
 * Zitadel v4 defaults `loginV2.required` to true, and the v2 login is a
 * *separate* Next.js service (`ghcr.io/zitadel/zitadel-login`) that the core
 * image does not serve. With the default left alone, every authorization
 * redirect lands on `/ui/v2/login/login?authRequest=…` and answers **404** — the
 * sign-in button appears to be broken while every probe stays green, which is
 * precisely the kind of failure a health ladder cannot see.
 *
 * Deploying the second container is the alternative. It is not worth it here:
 * the v1 login serves password, TOTP, social providers and self-registration —
 * everything this lab exercises — and one fewer moving part in a dev fleet is
 * worth more than a newer screen.
 */
const ensureLoginVersion = async () => {
  const features = await api('GET', '/v2/features/instance');
  if (features?.loginV2?.required !== true) {
    log('login version: v1 already in use');
    return;
  }
  await api('PUT', '/v2/features/instance', { loginV2: { required: false } });
  log('login version: pinned to v1 (the core image serves no v2 login)');
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
const readEnvValue = key => {
  let contents;
  try {
    contents = readFileSync(ZITADEL_ENV, 'utf8');
  } catch {
    return '';
  }
  const line = contents
    .split('\n')
    .find(candidate => candidate.startsWith(`${key}=`));
  return line === undefined ? '' : line.slice(key.length + 1).trim();
};

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
  await ensureLoginVersion();
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
