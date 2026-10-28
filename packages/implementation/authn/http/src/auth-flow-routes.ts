// The fleet's locales, registered before `isLocale` is asked about a sign-in's.
import '@r10c/business-ts-i18n/locales';

import {
  OneTimeTokenStoreTag,
  SessionStoreTag,
  TokenServiceTag,
} from '@entifix/business';
import { isLocale } from '@entifix/core';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccountRepositoryTag,
  IdTokenStoreTag,
  OIDC_STATE_TTL_SECONDS,
  OidcProviderTag,
  type Principal,
  ProviderEventVerifierTag,
  ProviderSessionIndexTag,
  PublicKeySetTag,
  resolveSessionUCFactory,
  resolveSignIn,
  SESSION_IDLE_TTL_SECONDS,
  SessionIdTag,
  UnauthenticatedError,
} from '@r10c/business-ts-authn';
import { Effect, Option } from 'effect';
import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  UrlParams,
} from 'effect/http';

import {
  asString,
  invalidRequest,
  readBody,
  readDevice,
  respondAuthError,
  serverError,
} from './auth-responses.js';
import { establishSession } from './establish-session.js';

/** Namespace for the pending-authorization tokens; see {@link oidcStartRoute}. */
const OIDC_STATE_PURPOSE = 'oidc-state';

const NO_STORE = Headers.fromInput({ 'cache-control': 'no-store' });

/** The pending authorization a redirect is stored under, as JSON. */
interface PendingAuthorization {
  readonly codeVerifier: string;
  readonly nonce: string;
  /** Where the browser wanted to go before it was sent to sign in. */
  readonly redirect?: string;
}

/**
 * `GET /.well-known/jwks.json` — the public half of this service's signing key.
 *
 * Unauthenticated by design: a public key is public, and withholding it protects
 * nothing while breaking every standard OIDC client. The private half never
 * appears here — the {@link PublicKeySetTag} contract forbids every private
 * member — so there is no path by which a signing key could reach this response.
 *
 * The fleet's own services do not read it: each resolves `jwt.publicKey` from
 * config-service at boot, so no verification depends on auth-service being up.
 * This exists for the consumers that hold no fleet configuration — a browser or
 * an edge runtime.
 */
const jwksRoute = Effect.gen(function* () {
  const keys = yield* PublicKeySetTag;
  return yield* HttpServerResponse.json(yield* keys.jwks());
}).pipe(Effect.catch(serverError));

/**
 * `POST /api/auth/oidc/start` — begin a sign-in.
 *
 * The one-time token store does double duty here, and it fits exactly: a
 * `state` handle wants to be unguessable, single-use, short-lived and hashed at
 * rest, which is the store's entire contract. The token it mints **is** the
 * `state`, so there is no second value to keep in step, and its subject is the
 * pending authorization the callback needs back.
 *
 * The PKCE verifier never leaves the server. That is what makes a public client
 * safe: an intercepted authorization code cannot be exchanged without it.
 *
 * `uiLocale` is the one caller-supplied value that reaches the redirect URL, and
 * it originates in a cookie the browser controls — so it is checked against the
 * fleet's locale list here rather than trusted from the app that forwarded it.
 * An unrecognised tag is dropped, never echoed.
 */
const oidcStartRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const provider = yield* OidcProviderTag;
  const tokens = yield* OneTimeTokenStoreTag;

  const { codeVerifier, codeChallenge, nonce } =
    yield* provider.newAuthorization();
  const pending: PendingAuthorization = {
    codeVerifier,
    nonce,
    redirect: asString(body['redirect']),
  };

  const state = yield* tokens.issue(
    OIDC_STATE_PURPOSE,
    JSON.stringify(pending),
    OIDC_STATE_TTL_SECONDS,
  );
  const requestedLocale = asString(body['uiLocale']);
  const authorizationUrl = yield* provider.authorizationUrl({
    state,
    nonce,
    codeChallenge,
    uiLocales: isLocale(requestedLocale) ? requestedLocale : undefined,
  });

  return yield* HttpServerResponse.json({ authorizationUrl });
}).pipe(Effect.catch(respondAuthError));

/**
 * `POST /api/auth/oidc/callback` — finish it.
 *
 * Consuming the state is the CSRF check and the replay check in one: a callback
 * whose `state` is unknown, expired, or already spent gets `401` and never
 * reaches the token endpoint. The `nonce` recovered alongside it is then what
 * binds the returned `id_token` to this same request.
 */
const oidcCallbackRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const code = asString(body['code']);
  const state = asString(body['state']);
  if (code === undefined || state === undefined) {
    return yield* invalidRequest();
  }

  const tokens = yield* OneTimeTokenStoreTag;
  const provider = yield* OidcProviderTag;
  const accounts = yield* AccountRepositoryTag;

  const pending = yield* tokens.consume(OIDC_STATE_PURPOSE, state).pipe(
    Effect.map(raw => JSON.parse(raw) as PendingAuthorization),
    Effect.catch(() =>
      Effect.fail(
        new UnauthenticatedError(
          'the authorization state is unknown or spent',
          'invalidState',
        ),
      ),
    ),
  );

  const identity = yield* provider.exchangeCode({
    code,
    codeVerifier: pending.codeVerifier,
    nonce: pending.nonce,
  });

  const subject = yield* resolveSignIn(accounts, provider.name, identity);
  const result = yield* establishSession(subject, readDevice(body));

  // Remembered so sign-out can end the provider's session too. Best-effort by
  // construction — a failure here costs a tidy logout, never the sign-in.
  const idTokens = yield* IdTokenStoreTag;
  yield* idTokens.remember(result.sessionId, identity.idToken);

  // And the reverse direction: without this line a logout token from the
  // provider names a session id that means nothing here. Also best-effort —
  // the back-channel route falls back to revoking by `sub`, which is what a
  // lost write looks like from there.
  if (identity.providerSessionId !== undefined) {
    const providerSessions = yield* ProviderSessionIndexTag;
    yield* providerSessions.link(identity.providerSessionId, result.sessionId);
  }

  return yield* HttpServerResponse.json(
    { ...result, redirect: pending.redirect },
    { status: 200 },
  );
}).pipe(Effect.catch(respondAuthError));

/**
 * `POST /api/auth/logout` — revoke the session so every service sees it gone,
 * and say where to send the browser so the provider's own session ends with it.
 *
 * Revoking locally without the second half is what leaves a "signed out" user
 * one click from being signed straight back in, with no password prompt,
 * because the provider still considers them authenticated.
 */
const logoutRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const sessionId = asString(body['sessionId']);
  let idToken: string | undefined;

  if (sessionId !== undefined) {
    const sessions = yield* SessionStoreTag;
    const idTokens = yield* IdTokenStoreTag;
    idToken = yield* idTokens.take(sessionId);
    yield* sessions.revoke(sessionId);
  }

  const provider = yield* OidcProviderTag;
  const endSessionUrl = yield* provider.endSessionUrl(idToken);
  return yield* HttpServerResponse.json({ ok: true, endSessionUrl });
}).pipe(
  // A provider that cannot be reached must not keep someone signed in: the
  // local revocation above has already happened by then.
  Effect.catch(() => HttpServerResponse.json({ ok: true })),
);

/**
 * `POST /api/auth/backchannel-logout` — the provider telling us a session it
 * owns has ended, so ours must end with it (ADR 0017).
 *
 * Unauthenticated, necessarily: the caller is a server, not a browser, and holds
 * no cookie. The logout token's signature is the authentication.
 *
 * Three shapes of answer, and the distinction matters:
 *  - a token that does not verify is `400`, so a misconfigured provider is loud;
 *  - a token that verifies but names nothing we know is `200`, because a `404`
 *    would make this endpoint an oracle for whether a session exists;
 *  - the body is form-encoded (`logout_token=…`) per the spec, not JSON.
 *
 * No `jti` replay store on purpose: every effect here is a revoke, `take`
 * empties the index, and revoking a revoked session is a no-op — so a replayed
 * token costs a round trip and nothing else. That stops being true the moment
 * this route does something non-idempotent.
 */
const backChannelLogoutRoute = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const form = yield* req.urlParamsBody;
  const logoutToken = UrlParams.getFirst(form, 'logout_token').pipe(
    Option.getOrUndefined,
  );
  if (logoutToken === undefined) {
    return yield* invalidRequest();
  }

  const provider = yield* OidcProviderTag;
  const event = yield* provider.verifyLogoutToken(logoutToken);

  const sessions = yield* SessionStoreTag;
  const idTokens = yield* IdTokenStoreTag;
  const providerSessions = yield* ProviderSessionIndexTag;

  const linked =
    event.providerSessionId === undefined
      ? []
      : yield* providerSessions.take(event.providerSessionId);

  for (const sessionId of linked) {
    yield* sessions.revoke(sessionId);
    // Drop the provider credential with the session it belonged to; nothing
    // will ever read it now.
    yield* idTokens.take(sessionId);
  }

  // No `sid`, or a `sid` that resolved to nothing — which is also what a lost
  // index write looks like. Falling back to the subject is what keeps that
  // failure from becoming a session that quietly survives.
  if (linked.length === 0 && event.subject !== undefined) {
    const accounts = yield* AccountRepositoryTag;
    const user = yield* accounts.findByIdentifier(event.subject);
    if (user !== null) {
      yield* sessions.revokeAllForUser(user.id);
    }
  }

  // `no-store` is required by the spec, and a proxy caching a logout response
  // would be its own small disaster.
  return yield* HttpServerResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE },
  );
}).pipe(
  Effect.catch(() =>
    HttpServerResponse.json(
      { error: 'invalid logout token', code: 'invalidRequest' },
      { status: 400 },
    ),
  ),
);

/**
 * `POST /api/auth/provider-events` — the provider telling us a user's standing
 * changed, so every session that user holds must end (ADR 0019).
 *
 * Ending a *session* at the provider fires a back-channel logout token, but
 * deactivating a *user* fires nothing at all; an event execution is what fills
 * that gap, without adding the provider to the refresh path.
 *
 * Unauthenticated, necessarily — the caller is a server holding no cookie — and
 * the signature over the raw body is the authentication. Hence `req.text`: the
 * MAC covers the bytes the provider sent, and `req.json` would hand back an
 * object whose re-serialisation is a different byte sequence.
 *
 * Answers match the back-channel route: `400` for a payload that does not
 * verify, `200` for a verified event about a subject we do not know, and `200`
 * for one we do not act on.
 *
 * It deliberately does **not** write `UserIdentity.status`: nothing projects
 * status back from the provider, so a local `disabled` written here would
 * survive a reactivation forever. Revoking is sufficient — the provider will not
 * authenticate a deactivated user, so no new session can open behind it.
 */
const providerEventRoute = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const rawBody = yield* req.text;

  const verifier = yield* ProviderEventVerifierTag;
  const event = yield* verifier.verify(rawBody, req.headers);

  if (event.revokesSessions) {
    const accounts = yield* AccountRepositoryTag;
    const user = yield* accounts.findByIdentifier(event.subject);
    if (user !== null) {
      const sessions = yield* SessionStoreTag;
      yield* sessions.revokeAllForUser(user.id);
    }
  }

  return yield* HttpServerResponse.json(
    { ok: true },
    { status: 200, headers: NO_STORE },
  );
}).pipe(
  Effect.catch(() =>
    HttpServerResponse.json(
      { error: 'invalid provider event', code: 'invalidRequest' },
      { status: 400 },
    ),
  ),
);

/**
 * `POST /api/auth/refresh` — mint a fresh access token from a still-live
 * session, sliding its window. Fails `401` if the session was revoked, went idle
 * past its window, or reached its absolute ceiling — which is where the short
 * token TTL becomes real revocation.
 *
 * `touch` runs BEFORE the token is signed on purpose: a session that has hit its
 * ceiling must not hand out one last token on its way out.
 *
 * Every claim is re-signed from the session record rather than re-resolved: the
 * session owns the active organization and the party role, and re-reading the
 * party store here would let a membership change silently move a live session
 * to another plane, and put a store read on a path that is deliberately
 * store-only.
 */
const refreshRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const sessionId = asString(body['sessionId']);
  if (sessionId === undefined) {
    return yield* invalidRequest();
  }
  const sessions = yield* SessionStoreTag;
  const tokens = yield* TokenServiceTag;

  yield* sessions.touch(sessionId, SESSION_IDLE_TTL_SECONDS);
  const record = yield* sessions.read(sessionId);
  const accessToken = yield* tokens.sign(
    {
      userId: record.userId,
      subject: record.subject,
      sessionId,
      roles: record.roles,
      activeOrganizationId: record.activeOrganizationId,
      partyRole: record.partyRole,
      partyId: record.partyId,
      entitlements: record.entitlements,
    },
    ACCESS_TOKEN_TTL_SECONDS,
  );

  return yield* HttpServerResponse.json({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionExpiresIn: Math.max(
      0,
      Math.floor((Date.parse(record.absoluteExpiresAt) - Date.now()) / 1000),
    ),
    sessionExpiresAt: record.absoluteExpiresAt,
    principal: {
      userId: record.userId,
      subject: record.subject,
      sessionId,
      roles: record.roles,
      organizationId: record.activeOrganizationId,
      partyRole: record.partyRole,
      partyId: record.partyId,
      attributes: record.attributes,
    } satisfies Principal,
  });
}).pipe(
  Effect.catch(() =>
    HttpServerResponse.json(
      { error: 'session expired', code: 'sessionExpired' },
      { status: 401 },
    ),
  ),
);

/** `GET /api/auth/session/:sessionId` — an opaque session id, resolved to a principal. */
const resolveSessionRoute = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const principal = yield* resolveSessionUCFactory().pipe(
    Effect.provideService(SessionIdTag, params.sessionId as string),
  );
  return yield* HttpServerResponse.json(principal);
}).pipe(
  // Authn failures collapse to 401 at the perimeter; cause is not leaked.
  Effect.catch(() =>
    HttpServerResponse.json(
      { error: 'session could not be resolved', code: 'sessionUnresolved' },
      { status: 401 },
    ),
  ),
);

/**
 * The credential flow. There is no `register` or `login` here and there cannot
 * be: this service holds no credential to check, so the only way in is a round
 * trip through the provider's hosted UI.
 */
export const authFlowRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/.well-known/jwks.json', jwksRoute),
  HttpRouter.route('POST', '/api/auth/oidc/start', oidcStartRoute),
  HttpRouter.route('POST', '/api/auth/oidc/callback', oidcCallbackRoute),
  HttpRouter.route('POST', '/api/auth/logout', logoutRoute),
  // The other half of sign-out, called by the provider rather than a browser.
  HttpRouter.route(
    'POST',
    '/api/auth/backchannel-logout',
    backChannelLogoutRoute,
  ),
  // And the half a logout token never covers: the provider ending a user.
  HttpRouter.route('POST', '/api/auth/provider-events', providerEventRoute),
  HttpRouter.route('POST', '/api/auth/refresh', refreshRoute),
  HttpRouter.route('GET', '/api/auth/session/:sessionId', resolveSessionRoute),
]);
