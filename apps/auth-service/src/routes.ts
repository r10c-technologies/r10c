import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  UrlParams,
} from '@effect/platform';
import {
  AccountRepositoryTag,
  type AuthSubject,
  EntityIdentifier,
  type IdentifierType,
  NotificationKind,
  NotificationPortTag,
  type Principal,
  RegisterInputTag,
  registerUserUCFactory,
  resolveSessionUCFactory,
  SessionIdTag,
  UnauthenticatedError,
  UpdateUserAspectsInputTag,
  updateUserAspectsUCFactory,
  UserDevice,
  UserDeviceRepositoryTag,
  UserIdentity,
  UserStatus,
} from '@r10c/business-ts-authn';
import {
  isRole,
  permissionForEntity,
  type Role,
} from '@r10c/business-ts-authz';
import {
  ConfigurationRepositoryTag,
  type DeviceContext,
  EntityIdTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
  OneTimeTokenStoreTag,
  type SessionRecord,
  SessionStoreTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixBuildError,
  Entity,
  EntityConstructor,
  EntityLoadRequest,
  extractMetaEntity,
  serializeEntity,
  serializeEntityCollection,
} from '@r10c/entifix-ts-core';
import { publicJwks } from '@r10c/entifix-ts-jwt-client';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import {
  ACTION_SIGNATURE_HEADER,
  createOpaqueValue,
  createPkcePair,
  ZitadelActionsTag,
  ZitadelManagementTag,
  ZitadelOidcTag,
} from '@r10c/entifix-ts-zitadel-client';
import {
  LoadedConfigurationTag,
  redactConfiguration,
  requirePermission,
  requirePrincipal,
} from '@r10c/shells-effect-service';
import { Effect, Option } from 'effect';

import { IdTokenStoreTag } from './identity/id-token-store';
import { describeIdentityModel } from './identity/identity-showcase';
import { readOutbox } from './identity/notifications';
import { ProviderSessionIndexTag } from './identity/provider-session-index';
import { provisionZitadelHuman, resolveSignIn } from './identity/provisioning';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_SESSION_LIFETIME,
  OIDC_STATE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
} from './identity/session-policy';
import { SessionScopeResolverTag } from './identity/session-scope';

/** Reads `page`/`pageSize` from the request query string. */
const readLoadRequest = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const search = new URL(req.url, 'http://localhost').searchParams;
  return {
    page: Number(search.get('page')) || 1,
    pageSize: Number(search.get('pageSize')) || 10,
  } satisfies EntityLoadRequest;
});

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'unexpected', detail: String(error) },
    { status: 500 },
  );

/** Generic list route backed by Mongo + the entifix load UC. */
const listRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const request = yield* readLoadRequest;
    const page = yield* loadUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityLoadRequestTag, request),
    );
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(entityConstructor, page.items),
      total: page.total,
      request: page.request,
    });
  }).pipe(Effect.catchAll(serverError));

/** Generic single-record route by `:id`. */
const byIdRoute = <T extends Entity>(entityConstructor: EntityConstructor<T>) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const params = yield* HttpRouter.params;
    const entity = yield* getUCFactory<T>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, entityConstructor),
      ),
      Effect.provideService(EntityIdTag, params.id),
    );
    return yield* HttpServerResponse.json(
      serializeEntity(entityConstructor, entity),
    );
  }).pipe(
    // The entity's own key, not a hardcoded English name passed at the call
    // site: the client translates `errors:notFound` and already knows how to
    // render that entity's label from its metadata.
    Effect.catchAll(() =>
      HttpServerResponse.json(
        {
          message: 'not found',
          code: 'notFound',
          entity: extractMetaEntity(entityConstructor).key,
        },
        { status: 404 },
      ),
    ),
  );

/**
 * `GET /.well-known/jwks.json` — the public half of this service's signing key.
 *
 * Unauthenticated by design: a public key is public, and withholding it protects
 * nothing while breaking every standard OIDC client. The private half never
 * appears here — {@link publicJwks} derives the set from the public PEM alone,
 * so there is no path by which a signing key could reach this response.
 *
 * The fleet's own services do not read it: each resolves `jwt.publicKey` from
 * config-service at boot, so no verification depends on auth-service being up.
 * This exists for the consumers that hold no fleet configuration — a browser or
 * an edge runtime, which is what buyer sessions on the public storefront will
 * need.
 */
const jwksRoute = Effect.gen(function* () {
  const store = yield* ConfigurationRepositoryTag;
  const publicKeyPem = yield* store.in('jwt').getString('publicKey');
  const keyId = yield* store.in('jwt').getString('keyId');
  return yield* HttpServerResponse.json(
    yield* Effect.promise(() => publicJwks(publicKeyPem, keyId)),
  );
}).pipe(Effect.catchAll(serverError));

/** `GET /api/config` — this service's loaded parameters (credentials redacted). */
const configIntrospectionRoute = Effect.gen(function* () {
  const plain = yield* LoadedConfigurationTag;
  return yield* HttpServerResponse.json({
    service: '@r10c/auth-service',
    store: 'mongo',
    configuration: redactConfiguration(plain),
  });
});

// #region auth flow

/** The JSON an authenticated flow returns; the Next app turns it into cookies. */
interface AuthResult {
  readonly accessToken: string;
  readonly sessionId: string;
  /** Seconds the ACCESS TOKEN is valid for — not the session. */
  readonly expiresIn: number;
  /**
   * Seconds until the session's absolute ceiling. The app sizes its cookies
   * against this rather than {@link AuthResult.expiresIn}: a cookie that dies
   * with the token makes an expired token indistinguishable from no session at
   * all, which is what used to sign everyone out every fifteen minutes.
   */
  readonly sessionExpiresIn: number;
  readonly principal: Principal;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Read the JSON request body as a record. */
const readBody = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* req.json;
  return (body ?? {}) as Record<string, unknown>;
});

/**
 * Map an authn failure to a status without leaking the cause.
 *
 * Every body carries a `code` — a key in the shared `errors` catalog — beside
 * the English `error`. The client renders the code; `error` stays for logs and
 * for any consumer that has not been taught the vocabulary. This used to send
 * the domain's own `message` as the response body, so a Spanish user read
 * "not allowed to assign that role".
 */
const respondAuthError = (error: { _tag?: string }) => {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message;

  switch (error._tag) {
    case 'UnauthenticatedError':
      return HttpServerResponse.json(
        { error: 'invalid credentials', code: code ?? 'invalidCredentials' },
        { status: 401 },
      );
    // Authenticated, but not permitted — the opposite of a 401, and not a
    // conflict either. Which rule refused is safe to say: knowing it reveals
    // nothing the caller could not infer.
    case 'ForbiddenError':
      return HttpServerResponse.json(
        { error: message ?? 'forbidden', code: code ?? 'forbidden' },
        { status: 403 },
      );
    case 'AuthnError':
      return HttpServerResponse.json(
        { error: message ?? 'request refused', code: code ?? 'invalidRequest' },
        { status: 409 },
      );
    case 'EntifixBuildError':
      return HttpServerResponse.json(
        { error: 'invalid request', code: 'invalidRequest' },
        { status: 400 },
      );
    default:
      return HttpServerResponse.json(
        { error: 'authentication failed', code: 'unexpected' },
        { status: 500 },
      );
  }
};

/** Read the optional device struct the `-app` edge parsed for us. */
const readDevice = (
  body: Record<string, unknown>,
): DeviceContext | undefined => {
  const raw = body['device'];
  if (typeof raw !== 'object' || raw === null) return undefined;
  const entry = raw as Record<string, unknown>;
  const deviceId = asString(entry['deviceId']);
  if (deviceId === undefined) return undefined;
  return {
    deviceId,
    browser: asString(entry['browser']),
    os: asString(entry['os']),
    type: asString(entry['type']),
    ip: asString(entry['ip']),
  };
};

/**
 * Turn a credential-verified {@link AuthSubject} into a live session + access
 * token. The session lands in Redis (revocation handle); the token carries only
 * the small, stable claims a downstream authorization check needs.
 *
 * The device rides on the session for display, and is separately remembered in
 * Mongo so "have I seen this browser before?" survives the session expiring. It
 * is a label throughout: nothing here consults it to decide anything.
 */
const establishSession = (
  subject: AuthSubject,
  device?: DeviceContext,
): Effect.Effect<
  AuthResult,
  never,
  | AccountRepositoryTag
  | SessionScopeResolverTag
  | NotificationPortTag
  | SessionStoreTag
  | TokenServiceTag
  | UserDeviceRepositoryTag
> =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const tokens = yield* TokenServiceTag;

    if (device !== undefined) {
      const devices = yield* UserDeviceRepositoryTag;
      const notifications = yield* NotificationPortTag;
      const accounts = yield* AccountRepositoryTag;
      // Best-effort throughout: neither a device-history write nor a
      // notification may cost someone their sign-in. They are labels and
      // warnings; the session is the thing that matters.
      yield* devices.remember(subject.userId, device).pipe(
        Effect.flatMap(remembered =>
          // Only on FIRST sight. Announcing a familiar browser every time is
          // how a security alert becomes noise the owner filters out.
          remembered.isNew
            ? accounts.findContactAddress(subject.userId).pipe(
                Effect.flatMap(to =>
                  // No contact address means nowhere to send it — a
                  // username-only account is not an error.
                  to === null
                    ? Effect.void
                    : notifications.send({
                        kind: NotificationKind.NewDevice,
                        userId: subject.userId,
                        to,
                        data: {
                          browser: device.browser ?? 'unknown',
                          os: device.os ?? 'unknown',
                          ip: device.ip ?? 'unknown',
                        },
                      }),
                ),
              )
            : Effect.void,
        ),
        Effect.catchAll(() => Effect.void),
      );
    }

    // What this session may reach: which population the party belongs to, and
    // which organization it acts for. Resolved once, at sign-in, and then
    // carried by the session — so `requirePrincipal` stays stateless and no
    // service re-reads a membership on the hot path. A missing organization is
    // a normal answer: a buyer or an operator holds no tenant scope, and
    // `partyRole` is what tells those two apart.
    const scopes = yield* SessionScopeResolverTag;
    const { organizationId: activeOrganizationId, partyRole } =
      yield* scopes.forUser(String(subject.userId));

    const sessionId = yield* sessions.create(
      { ...subject, activeOrganizationId, partyRole, device },
      DEFAULT_SESSION_LIFETIME,
    );
    const accessToken = yield* tokens.sign(
      {
        userId: subject.userId,
        subject: subject.subject,
        sessionId,
        roles: subject.roles,
        activeOrganizationId,
        partyRole,
      },
      ACCESS_TOKEN_TTL_SECONDS,
    );

    return {
      accessToken,
      sessionId,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      sessionExpiresIn: DEFAULT_SESSION_LIFETIME.absoluteTtlSeconds,
      principal: {
        ...subject,
        organizationId: activeOrganizationId,
        partyRole,
        sessionId,
      },
    };
  }).pipe(Effect.orDie);

/**
 * Parse an administrative account-creation body into the use-case input, or
 * fail 400.
 *
 * No password is read, and none may be supplied: the account this creates has
 * no credential in r10c at all, and the one Zitadel holds is set through the
 * provisioning call that follows.
 */
const parseRegister = (body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const rawIdentifiers = Array.isArray(body['identifiers'])
      ? body['identifiers']
      : [];
    const identifiers = rawIdentifiers
      .map(entry => entry as Record<string, unknown>)
      .map(entry => ({
        type: asString(entry['type']) as IdentifierType | undefined,
        value: asString(entry['value']),
      }))
      .filter(
        (entry): entry is { type: IdentifierType; value: string } =>
          entry.type !== undefined && entry.value !== undefined,
      );

    if (identifiers.length === 0) {
      return yield* Effect.fail(
        new EntifixBuildError('an account needs at least one identifier'),
      );
    }

    return {
      displayName: asString(body['displayName']),
      identifiers,
    };
  });

/** The pending authorization a redirect is stored under, as JSON in Redis. */
interface PendingAuthorization {
  readonly codeVerifier: string;
  readonly nonce: string;
  /** Where the browser wanted to go before it was sent to sign in. */
  readonly redirect?: string;
}

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
 */
const oidcStartRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const oidc = yield* ZitadelOidcTag;
  const tokens = yield* OneTimeTokenStoreTag;

  const { codeVerifier, codeChallenge } = createPkcePair();
  const nonce = createOpaqueValue();
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
  const authorizationUrl = yield* oidc.authorizationUrl({
    state,
    nonce,
    codeChallenge,
  });

  return yield* HttpServerResponse.json({ authorizationUrl });
}).pipe(Effect.catchAll(respondAuthError));

/** Namespace for the pending-authorization tokens; see {@link oidcStartRoute}. */
const OIDC_STATE_PURPOSE = 'oidc-state';

/**
 * `POST /api/auth/oidc/callback` — finish it.
 *
 * Consuming the state is the CSRF check and the replay check in one: a callback
 * whose `state` is unknown, expired, or already spent gets `401` and never
 * reaches the token endpoint. The `nonce` recovered alongside it is then what
 * binds the returned `id_token` to this same request.
 *
 * From `resolveSignIn` onward this is the ordinary path — the same
 * `establishSession` that has always run, so cookies, device history, party
 * role and tenancy are untouched by the swap.
 */
const oidcCallbackRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const code = asString(body['code']);
  const state = asString(body['state']);
  if (code === undefined || state === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
  }

  const tokens = yield* OneTimeTokenStoreTag;
  const oidc = yield* ZitadelOidcTag;
  const accounts = yield* AccountRepositoryTag;

  const pending = yield* tokens.consume(OIDC_STATE_PURPOSE, state).pipe(
    Effect.map(raw => JSON.parse(raw) as PendingAuthorization),
    Effect.catchAll(() =>
      Effect.fail(
        new UnauthenticatedError(
          'the authorization state is unknown or spent',
          'invalidState',
        ),
      ),
    ),
  );

  const identity = yield* oidc.exchangeCode({
    code,
    codeVerifier: pending.codeVerifier,
    nonce: pending.nonce,
  });

  const subject = yield* resolveSignIn(accounts, identity);
  const result = yield* establishSession(subject, readDevice(body));

  // Remembered so sign-out can end the provider's session too. Best-effort by
  // construction — a failure here costs a tidy logout, never the sign-in.
  const idTokens = yield* IdTokenStoreTag;
  yield* idTokens.remember(result.sessionId, identity.idToken);

  // And the reverse direction: without this line a logout token from Zitadel
  // names a session id that means nothing here. Also best-effort — the
  // back-channel route falls back to revoking by `sub`, which is what a lost
  // write looks like from there.
  if (identity.providerSessionId !== undefined) {
    const providerSessions = yield* ProviderSessionIndexTag;
    yield* providerSessions.link(identity.providerSessionId, result.sessionId);
  }

  return yield* HttpServerResponse.json(
    { ...result, redirect: pending.redirect },
    { status: 200 },
  );
}).pipe(Effect.catchAll(respondAuthError));

/**
 * `POST /api/auth/logout` — revoke the session so every service sees it gone,
 * and say where to send the browser so Zitadel's own session ends with it.
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

  const oidc = yield* ZitadelOidcTag;
  const endSessionUrl = yield* oidc.endSessionUrl(idToken);
  return yield* HttpServerResponse.json({ ok: true, endSessionUrl });
}).pipe(
  // A provider that cannot be reached must not keep someone signed in: the
  // local revocation above has already happened by then.
  Effect.catchAll(() => HttpServerResponse.json({ ok: true })),
);

/**
 * `POST /api/auth/backchannel-logout` — Zitadel telling us a session it owns has
 * ended, so ours must end with it.
 *
 * Without this route sign-out is one-way. Ending a session at the provider —
 * signing out of the console, an operator terminating sessions — left the r10c
 * session alive until its own seven-day ceiling, minting a fresh access token on
 * every refresh in between. "Sign me out everywhere" is exactly the control
 * someone reaches for when they believe an account is compromised, and it was
 * signing them out of nothing.
 *
 * Unauthenticated, necessarily: the caller is a server, not a browser, and holds
 * no cookie. The logout token's signature is the authentication — see
 * `verifyLogoutToken`, whose `nonce` check is what stops a stolen `id_token`
 * being POSTed here instead.
 *
 * Three shapes of answer, and the distinction matters:
 *  - a token that does not verify is `400`, so a misconfigured provider is loud;
 *  - a token that verifies but names nothing we know is `200`, because a `404`
 *    would make this endpoint an oracle for whether a session exists;
 *  - the body is form-encoded (`logout_token=…`) per the spec, not JSON.
 *
 * No `jti` replay store on purpose: every effect here is a revoke, `take`
 * empties the index, and revoking a revoked session is a no-op — so a replayed
 * token costs a Redis round trip and nothing else. That stops being true the
 * moment this route does something non-idempotent.
 */
const backChannelLogoutRoute = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const form = yield* req.urlParamsBody;
  const logoutToken = UrlParams.getFirst(form, 'logout_token').pipe(
    Option.getOrUndefined,
  );
  if (logoutToken === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
  }

  const oidc = yield* ZitadelOidcTag;
  const event = yield* oidc.verifyLogoutToken(logoutToken);

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

  return yield* HttpServerResponse.json(
    { ok: true },
    // Required by the spec, and a proxy caching a logout response would be its
    // own small disaster.
    {
      status: 200,
      headers: Headers.fromInput({ 'cache-control': 'no-store' }),
    },
  );
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.json(
      { error: 'invalid logout token', code: 'invalidRequest' },
      { status: 400 },
    ),
  ),
);

/**
 * `POST /api/auth/provider-events` — the provider telling us a user's standing
 * changed, so every session that user holds must end.
 *
 * The gap this closes, measured on Zitadel v4.16.2: ending a *session* fires a
 * back-channel logout token, but deactivating a *user* fires nothing at all. The
 * account was gone and the r10c session kept refreshing `200` — for up to its
 * seven-day ceiling — which is the opposite of what deactivating an account is
 * for. A Zitadel Actions v2 event execution is what fills it: event-driven, so
 * nothing is added to `refresh`, and no availability of the provider is put on a
 * path that runs every twelve minutes per active user (both rejected in ADR
 * 0017, and still rejected).
 *
 * Named for the provider role rather than for Zitadel, like the identifiers it
 * resolves: what arrives here is "the identity provider says this subject may no
 * longer hold a session", and the next provider would say it the same way.
 *
 * Unauthenticated, necessarily — the caller is a server holding no cookie — and
 * the HMAC over the raw body is the authentication, exactly as the logout
 * token's signature is next door. Hence `req.text`: the MAC covers the bytes
 * Zitadel sent, and `req.json` would hand back an object whose re-serialisation
 * is a different byte sequence.
 *
 * Three shapes of answer, matching the back-channel route:
 *  - a payload that does not verify is `400`, so a key mismatch is loud;
 *  - a verified event naming a subject we do not know is `200`, because a `404`
 *    would make this an oracle for whether an account exists here;
 *  - a verified event we do not act on is `200`, so an execution can be added at
 *    the provider without a deploy here.
 *
 * What it deliberately does **not** do is write `UserIdentity.status`. Nothing
 * projects status back from Zitadel — `resolveSignIn` refuses a non-`Active`
 * user *before* `projectIdentity` runs, and that projection never touches status
 * — so a local `disabled` written here would survive a Zitadel *re*activation
 * forever and lock the account out of r10c with nothing able to undo it.
 * Revoking is also sufficient: Zitadel will not authenticate a deactivated user,
 * so no new session can open behind the revocation.
 *
 * Stored `id_token`s are left to expire with their sessions, as in the
 * back-channel route's `sub` fallback — `revokeAllForUser` does not hand back
 * the ids that would be needed to sweep them, and nothing will ever read them.
 */
const providerEventRoute = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const rawBody = yield* req.text;
  const signature = req.headers[ACTION_SIGNATURE_HEADER];

  const actions = yield* ZitadelActionsTag;
  const event = yield* actions.verifyEvent(rawBody, signature);

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
    {
      status: 200,
      headers: Headers.fromInput({ 'cache-control': 'no-store' }),
    },
  );
}).pipe(
  Effect.catchAll(() =>
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
 * Sliding here rather than on every guarded request is deliberate.
 * `requirePrincipal` verifies statelessly and never reads the store, and putting
 * Redis back on that path to measure activity would undo the property. Instead
 * the browser stops refreshing once the user goes idle, so what renews a session
 * is a person using it rather than a tab being left open.
 */
const refreshRoute = Effect.gen(function* () {
  const body = yield* readBody;
  const sessionId = asString(body['sessionId']);
  if (sessionId === undefined) {
    return yield* HttpServerResponse.json(
      { error: 'invalid request', code: 'invalidRequest' },
      { status: 400 },
    );
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
      // The session owns the active organization, so a refresh preserves it —
      // including one chosen by an explicit switch rather than at sign-in. The
      // same holds for the party role: re-resolving it here would let a
      // membership change silently move a live session to another plane.
      activeOrganizationId: record.activeOrganizationId,
      partyRole: record.partyRole,
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
      attributes: record.attributes,
    } satisfies Principal,
  });
}).pipe(
  Effect.catchAll(() =>
    HttpServerResponse.json(
      { error: 'session expired', code: 'sessionExpired' },
      { status: 401 },
    ),
  ),
);

// #endregion auth flow

// #region development

/**
 * `GET /api/dev/outbox` — the notifications this service has sent.
 *
 * Gated on `NODE_ENV !== 'production'` and answering 404 otherwise, so the route
 * does not even admit to existing in a deployed environment. It exists because
 * the password-reset link is deliberately never returned in a response body:
 * without a readable record, the reset journey could not be tested end to end at
 * all, and an untested recovery flow is one that quietly rots.
 *
 * A single flag guards it, so the check is written once, here, rather than
 * repeated per handler where one omission would expose every reset link.
 */
const devOutboxRoute = Effect.gen(function* () {
  if (process.env.NODE_ENV === 'production') {
    return yield* HttpServerResponse.json(
      { error: 'not found', code: 'notFound' },
      { status: 404 },
    );
  }

  const db = yield* MongoDatabaseTag;
  const req = yield* HttpServerRequest.HttpServerRequest;
  const to = new URL(req.url, 'http://localhost').searchParams.get('to');
  const items = yield* readOutbox(db, to ?? undefined);
  return yield* HttpServerResponse.json({ items });
}).pipe(Effect.catchAllCause(serverError));

// #endregion development

// #region sessions

/** What a session row looks like on the wire. */
const serializeSession = (record: SessionRecord, currentSessionId: string) => ({
  sessionId: record.sessionId,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  absoluteExpiresAt: record.absoluteExpiresAt,
  /** So the UI can label the row you are reading it from. */
  current: record.sessionId === currentSessionId,
  device: record.device ?? null,
});

/** Read a user's live sessions, newest first. */
const listSessions = (userId: string, currentSessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    const records = yield* sessions.listForUser(userId);
    return [...records]
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      )
      .map(record => serializeSession(record, currentSessionId));
  });

/** `GET /api/auth/sessions` — where the caller is signed in. */
const mySessionsRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const items = yield* listSessions(
      String(principal.userId),
      principal.sessionId,
    );
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catchAll(serverError)),
);

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 *
 * The ownership check is the point. `SessionStore.revoke` will kill any id it is
 * handed, which was safe while only logout called it with your own; the moment a
 * route accepts an id from the outside, a session id that leaks into a log or a
 * URL becomes a remote-logout weapon. Revoking your CURRENT session is allowed
 * and simply signs you out.
 */
const revokeMySessionRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const target = params.sessionId ?? '';
    const sessions = yield* SessionStoreTag;

    const record = yield* sessions.read(target);
    if (String(record.userId) !== String(principal.userId)) {
      // Deliberately 404, not 403: confirming the id exists would tell a caller
      // they guessed a real session belonging to someone else.
      return yield* HttpServerResponse.json(
        { error: 'not found', code: 'notFound' },
        { status: 404 },
      );
    }

    yield* sessions.revoke(target);
    return yield* HttpServerResponse.json({
      ok: true,
      signedOut: target === principal.sessionId,
    });
  }).pipe(
    Effect.catchAll(() =>
      HttpServerResponse.json(
        { error: 'not found', code: 'notFound' },
        { status: 404 },
      ),
    ),
  ),
);

/** `POST /api/auth/sessions/revoke-others` — keep this one, end the rest. */
const revokeOtherSessionsRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUserExcept(
      principal.userId,
      principal.sessionId,
    );
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catchAll(serverError)),
);

/** `GET /api/auth/devices` — the caller's remembered browsers. */
const myDevicesRoute = requirePrincipal(principal =>
  Effect.gen(function* () {
    const devices = yield* UserDeviceRepositoryTag;
    const items = yield* devices.listForUser(principal.userId);
    return yield* HttpServerResponse.json({
      items: serializeEntityCollection(UserDevice, items),
    });
    // `catchAllCause`, not `catchAll`: a bad value in a stored document throws
    // rather than failing, and a defect would otherwise escape as an empty 500
    // with nothing in the body to debug from.
  }).pipe(Effect.catchAllCause(serverError)),
);

// #endregion sessions

// #region user management

/** Every user-management route speaks this vocabulary, derived from the entity. */
const USER_READ = permissionForEntity(UserIdentity, 'read');
const USER_WRITE = permissionForEntity(UserIdentity, 'write');
const IDENTIFIER_READ = permissionForEntity(EntityIdentifier, 'read');
/** Looking at, and ending, somebody else's sessions. */
const DEVICE_READ = permissionForEntity(UserDevice, 'read');
const DEVICE_WRITE = permissionForEntity(UserDevice, 'write');

/**
 * `GET /api/user-identity/:id/sessions` — an administrator's view of where a
 * user is signed in, for incident response.
 *
 * Behind a permission derived from the entity itself, exactly like every other
 * administrative route. Another user's device history is not public just because
 * the caller happens to be staff.
 */
const userSessionsRoute = requirePermission(DEVICE_READ)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const items = yield* listSessions(params.id ?? '', principal.sessionId);
    return yield* HttpServerResponse.json({ items });
  }).pipe(Effect.catchAll(serverError)),
);

/**
 * `DELETE /api/user-identity/:id/sessions` — sign a user out everywhere.
 *
 * The owner is told, because they did not do it: being signed out of every
 * device with no explanation looks exactly like an account compromise, and
 * someone who cannot tell those apart cannot report either. Best-effort, like
 * every other notification — a mail failure must not leave the sessions alive.
 */
const revokeUserSessionsRoute = requirePermission(DEVICE_WRITE)(() =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const userId = params.id ?? '';
    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUser(userId);
    yield* notifySessionsRevoked(userId);
    return yield* HttpServerResponse.json({ ok: true });
  }).pipe(Effect.catchAll(serverError)),
);

/** Tell the owner their sessions were ended for them. Never blocking. */
const notifySessionsRevoked = (userId: Principal['userId']) =>
  Effect.gen(function* () {
    const accounts = yield* AccountRepositoryTag;
    const notifications = yield* NotificationPortTag;
    const to = yield* accounts.findContactAddress(userId);
    // A username-only account has nowhere to send it, which is not an error.
    if (to === null) return;
    yield* notifications.send({
      kind: NotificationKind.SessionsRevoked,
      userId,
      to,
    });
  }).pipe(Effect.catchAll(() => Effect.void));

/** Read the requested role from a body, rejecting an unrecognised one. */
const parseRole = (value: unknown): Role | undefined =>
  isRole(value) ? value : undefined;

/**
 * `POST /api/user-identity` — administrative account creation.
 *
 * Deliberately the SAME use-case a first sign-in runs: a generic entity write
 * would skip identifier uniqueness and the tier rule. The actor comes from the
 * verified principal, never from the body.
 *
 * Two systems, written in a fixed order and without a saga. The local record
 * goes first because it owns the role and the party — the two things Zitadel
 * never sees — and the human second. If the second half fails the caller gets a
 * `409` and the account is left with no external subject: it cannot sign in, it
 * is listed like any other, and submitting the same form again repairs it. See
 * ADR 0016 for why this beats a compensating delete that can itself fail.
 */
const createUserRoute = requirePermission(USER_WRITE)(principal =>
  Effect.gen(function* () {
    const body = yield* readBody;
    const input = yield* parseRegister(body);
    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }

    const email = input.identifiers.find(
      identifier => identifier.type === 'email',
    )?.value;
    if (email === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'an email identifier is required', code: 'emailRequired' },
        { status: 400 },
      );
    }

    const subject = yield* registerUserUCFactory().pipe(
      Effect.provideService(RegisterInputTag, {
        ...input,
        role,
        actorRoles: principal.roles,
      }),
    );

    const zitadel = yield* ZitadelManagementTag;
    const accounts = yield* AccountRepositoryTag;
    yield* provisionZitadelHuman(accounts, zitadel, {
      userId: subject.userId,
      email,
      username: input.identifiers.find(
        identifier => identifier.type === 'username',
      )?.value,
      displayName: input.displayName,
    });

    return yield* HttpServerResponse.json(subject, { status: 201 });
  }).pipe(Effect.catchAll(respondAuthError)),
);

/**
 * `PATCH /api/user-identity/:id` — change a user's role or status, then revoke
 * their sessions. Revocation is what makes the change immediate: grants are
 * derived from the `roles` claim, so without it a demoted user would keep their
 * old access until the token expired.
 */
const updateUserRoute = requirePermission(USER_WRITE)(principal =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const body = yield* readBody;
    const userId = params.id ?? '';

    const role = parseRole(body['role']);
    if (body['role'] !== undefined && role === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown role', code: 'unknownRole' },
        { status: 400 },
      );
    }
    const rawStatus = asString(body['status']);
    const status = Object.values(UserStatus).includes(rawStatus as UserStatus)
      ? (rawStatus as UserStatus)
      : undefined;
    if (rawStatus !== undefined && status === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'unknown status', code: 'unknownStatus' },
        { status: 400 },
      );
    }

    const updated = yield* updateUserAspectsUCFactory().pipe(
      Effect.provideService(UpdateUserAspectsInputTag, {
        userId,
        role,
        status,
        actorUserId: principal.userId,
        actorRoles: principal.roles,
      }),
    );

    const sessions = yield* SessionStoreTag;
    yield* sessions.revokeAllForUser(userId);

    return yield* HttpServerResponse.json(
      serializeEntity(UserIdentity, updated),
    );
  }).pipe(Effect.catchAll(respondAuthError)),
);

// #endregion user management

/**
 * Everything the credential flow and a signed-in user's own account need.
 *
 * Split from {@link userManagementRoutes} because `pipe` accepts at most 20
 * arguments and this surface outgrew it — the seam is "your own identity" vs
 * "administering someone else's", which is the same line the permissions draw.
 */
const identityRoutes = HttpRouter.empty.pipe(
  HttpRouter.get('/api/config', configIntrospectionRoute),
  HttpRouter.get('/.well-known/jwks.json', jwksRoute),
  // Sign-in flow. There is no `register` or `login` here any more and there
  // cannot be: this service holds no credential to check, so the only way in is
  // a round trip through the provider's hosted UI.
  HttpRouter.post('/api/auth/oidc/start', oidcStartRoute),
  HttpRouter.post('/api/auth/oidc/callback', oidcCallbackRoute),
  HttpRouter.post('/api/auth/logout', logoutRoute),
  // The other half of sign-out, called by Zitadel rather than by a browser.
  HttpRouter.post('/api/auth/backchannel-logout', backChannelLogoutRoute),
  // And the half a logout token never covers: the provider ending a user, not a
  // session. Also called by Zitadel, over Actions v2 rather than over OIDC.
  HttpRouter.post('/api/auth/provider-events', providerEventRoute),
  HttpRouter.post('/api/auth/refresh', refreshRoute),
  // Session self-service. Every one of these resolves the caller from the
  // verified token and checks ownership — an id in the URL is never authority.
  HttpRouter.get('/api/auth/sessions', mySessionsRoute),
  HttpRouter.post('/api/auth/sessions/revoke-others', revokeOtherSessionsRoute),
  HttpRouter.del('/api/auth/sessions/:sessionId', revokeMySessionRoute),
  HttpRouter.get('/api/auth/devices', myDevicesRoute),
  // No password routes. Changing a password, enrolling a second factor and
  // recovering an account are all Zitadel self-service now; the account page
  // links out to it rather than proxying an endpoint we would have to secure.
  // Development only — 404s in production. See `devOutboxRoute`.
  HttpRouter.get('/api/dev/outbox', devOutboxRoute),
  // Resolve an opaque session id → principal via the framework-free use-case.
  HttpRouter.get(
    '/api/auth/session/:sessionId',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const sessionId = params.sessionId ?? '';
      const principal = yield* resolveSessionUCFactory().pipe(
        Effect.provideService(SessionIdTag, sessionId),
      );
      return yield* HttpServerResponse.json(principal);
    }).pipe(
      // Authn failures collapse to 401 at the perimeter; cause is not leaked.
      Effect.catchAll(() =>
        HttpServerResponse.json(
          { error: 'session could not be resolved', code: 'sessionUnresolved' },
          { status: 401 },
        ),
      ),
    ),
  ),
  // The caller's own verified identity — what a Next server layout reads to
  // decide whether to render the back-office and which nav items to show.
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
);

/** Administering other people's accounts. Every route here is permission-gated. */
const userManagementRoutes = HttpRouter.empty.pipe(
  // Canonical user records, backed by MongoDB. Every one of these is behind a
  // permission: this is the authorization boundary, and the UI hiding a menu
  // entry protects nothing on its own.
  HttpRouter.get(
    '/api/user-identity',
    requirePermission(USER_READ)(() => listRoute(UserIdentity)),
  ),
  HttpRouter.post('/api/user-identity', createUserRoute),
  HttpRouter.get(
    '/api/user-identity/:id',
    requirePermission(USER_READ)(() => byIdRoute(UserIdentity)),
  ),
  HttpRouter.patch('/api/user-identity/:id', updateUserRoute),
  // Administrative session control — incident response, permission-gated.
  HttpRouter.get('/api/user-identity/:id/sessions', userSessionsRoute),
  HttpRouter.del('/api/user-identity/:id/sessions', revokeUserSessionsRoute),
  HttpRouter.get(
    '/api/entity-identifier',
    requirePermission(IDENTIFIER_READ)(() => listRoute(EntityIdentifier)),
  ),
  HttpRouter.get(
    '/api/entity-identifier/:id',
    requirePermission(IDENTIFIER_READ)(() => byIdRoute(EntityIdentifier)),
  ),
  // Native-entity proof: construct entity classes + read stage-3 metadata.
  HttpRouter.get(
    '/api/identity/demo',
    Effect.sync(describeIdentityModel).pipe(
      Effect.flatMap(model => HttpServerResponse.json(model)),
    ),
  ),
);

/**
 * auth-service routes. `/api/health` is added by the service base. The auth
 * endpoints return JSON (tokens + principal); the Next app owns turning that
 * into httpOnly cookies, so this service needs no cookie/CORS handling.
 */
export const router = HttpRouter.concat(identityRoutes, userManagementRoutes);
