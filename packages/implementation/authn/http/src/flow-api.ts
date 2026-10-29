// The fleet's locales, registered before `isLocale` is asked about a sign-in's.
import '@r10c/business-ts-i18n/locales';

import {
  OneTimeTokenStoreTag,
  SessionStoreTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  Declined,
  defineEndpoint,
  DuplicateKey,
  formBody,
  implement,
  isLocale,
  JsonBody,
  NotFound,
  textBody,
  Unauthenticated,
} from '@entifix/core';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AccountInactive,
  AccountRepositoryTag,
  IdTokenStoreTag,
  InvalidRequest,
  InvalidState,
  OIDC_STATE_TTL_SECONDS,
  OidcProviderTag,
  type Principal,
  ProviderEventVerifierTag,
  ProviderSessionIndexTag,
  PublicKeySetTag,
  resolveSessionUCFactory,
  resolveSignIn,
  SESSION_IDLE_TTL_SECONDS,
  SessionExpired,
  SessionIdTag,
  SessionUnresolved,
  SignInFailed,
} from '@r10c/business-ts-authn';
import { Effect, Schema } from 'effect';

import { establishSession } from './establish-session.js';
import { asString, bodyOf, readDevice } from './request-body.js';

/** Namespace for the pending-authorization tokens; see {@link oidcStart}. */
const OIDC_STATE_PURPOSE = 'oidc-state';

/** The pending authorization a redirect is stored under, as JSON. */
interface PendingAuthorization {
  readonly codeVerifier: string;
  readonly nonce: string;
  /** Where the browser wanted to go before it was sent to sign in. */
  readonly redirect?: string;
}

const Ok = Schema.Struct({ ok: Schema.Boolean });

/**
 * `GET /.well-known/jwks.json` — the public half of this service's signing
 * key. Public by design: withholding a public key protects nothing while
 * breaking every standard OIDC client, and the {@link PublicKeySetTag}
 * contract forbids every private member. The fleet's own services do not read
 * it — each resolves `jwt.publicKey` from config-service at boot — so this
 * exists for consumers that hold no fleet configuration.
 */
const jwks = defineEndpoint({
  name: 'jwks',
  method: 'GET',
  path: '/.well-known/jwks.json',
  success: JsonBody,
  errors: [],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/oidc/start` — begin a sign-in. The one-time token store's
 * token **is** the `state`: unguessable, single-use, short-lived and hashed at
 * rest, with the pending authorization as its subject. The PKCE verifier never
 * leaves the server. `uiLocale` comes from a cookie the browser controls, so
 * it is checked against the fleet's locales and dropped, never echoed, when
 * it is not one.
 */
const oidcStart = defineEndpoint({
  name: 'oidc-start',
  method: 'POST',
  path: '/api/auth/oidc/start',
  payload: JsonBody,
  success: Schema.Struct({ authorizationUrl: Schema.String }),
  errors: [Declined, DuplicateKey, NotFound],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/oidc/callback` — finish it. Consuming the state is the CSRF
 * check and the replay check in one; the `nonce` recovered beside it binds
 * the returned `id_token` to this same request.
 */
const oidcCallback = defineEndpoint({
  name: 'oidc-callback',
  method: 'POST',
  path: '/api/auth/oidc/callback',
  payload: JsonBody,
  success: JsonBody,
  errors: [
    InvalidRequest,
    InvalidState,
    AccountInactive,
    SignInFailed,
    Unauthenticated,
    DuplicateKey,
    NotFound,
  ],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/logout` — revoke the session so every service sees it gone,
 * and say where to send the browser so the provider's own session ends with
 * it. A provider that cannot be reached must not keep anyone signed in: the
 * local revocation has already happened by then, so this always answers ok.
 */
const logout = defineEndpoint({
  name: 'logout',
  method: 'POST',
  path: '/api/auth/logout',
  payload: JsonBody,
  success: Schema.Struct({
    ok: Schema.Boolean,
    endSessionUrl: Schema.optionalKey(Schema.String),
  }),
  errors: [],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/backchannel-logout` — the provider telling us a session it
 * owns has ended (ADR 0017). Public, necessarily: the logout token's
 * signature is the authentication, and the body is form-encoded per the spec.
 * A token that does not verify is `400`, so a misconfigured provider is loud;
 * one that verifies but names nothing we know is `200`, because a `404` would
 * make this an oracle for whether a session exists. No `jti` store: every
 * effect is a revoke, so a replayed token costs a round trip and nothing else.
 */
const backChannelLogout = defineEndpoint({
  name: 'backchannel-logout',
  method: 'POST',
  path: '/api/auth/backchannel-logout',
  payload: formBody({ logout_token: Schema.String }),
  success: Ok,
  errors: [InvalidRequest, DuplicateKey, NotFound],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/provider-events` — the provider telling us a user's
 * standing changed, so every session they hold must end (ADR 0019). The MAC
 * covers the bytes the provider sent, so the body is taken as text: an object
 * re-serialised is a different byte sequence. A payload that does not verify
 * is `401`. It never writes `UserIdentity.status` — nothing projects status
 * back from the provider, so a local `disabled` would survive a reactivation.
 */
const providerEvents = defineEndpoint({
  name: 'provider-events',
  method: 'POST',
  path: '/api/auth/provider-events',
  // The provider signs a JSON body and posts it as JSON; the bytes are kept.
  payload: textBody('application/json'),
  // Every header, as the verifier port takes them: which one carries the
  // signature is the provider adapter's to know, not this cell's.
  headers: Schema.Record(Schema.String, Schema.String),
  success: Ok,
  errors: [Unauthenticated, DuplicateKey, NotFound],
  guard: { kind: 'public' },
});

/**
 * `POST /api/auth/refresh` — a fresh access token from a still-live session,
 * sliding its window. `touch` runs before the token is signed, so a session at
 * its ceiling hands out no last token. Every claim is re-signed from the
 * session record rather than re-resolved: re-reading the party store here
 * would let a membership change silently move a live session to another plane.
 */
const refresh = defineEndpoint({
  name: 'refresh',
  method: 'POST',
  path: '/api/auth/refresh',
  payload: JsonBody,
  success: JsonBody,
  errors: [InvalidRequest, SessionExpired, DuplicateKey],
  guard: { kind: 'public' },
});

/** `GET /api/auth/session/:sessionId` — an opaque session id, resolved to a principal. */
const resolveSession = defineEndpoint({
  name: 'resolve-session',
  method: 'GET',
  path: '/api/auth/session/:sessionId',
  params: { sessionId: Schema.String },
  success: JsonBody,
  errors: [SessionUnresolved, DuplicateKey],
  guard: { kind: 'public' },
});

/**
 * The credential flow. There is no `register` or `login` here and there
 * cannot be: this service holds no credential to check, so the only way in is
 * a round trip through the provider's hosted UI.
 */
export const authFlowEndpoints = [
  implement(jwks, () => Effect.flatMap(PublicKeySetTag, keys => keys.jwks())),
  implement(oidcStart, ({ payload }) =>
    Effect.gen(function* () {
      const body = bodyOf(payload);
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
      return { authorizationUrl };
    }),
  ),
  implement(oidcCallback, ({ payload }) =>
    Effect.gen(function* () {
      const body = bodyOf(payload);
      const code = asString(body['code']);
      const state = asString(body['state']);
      if (code === undefined || state === undefined) {
        return yield* new InvalidRequest({
          reason: 'a callback carries a code and a state',
        });
      }

      const tokens = yield* OneTimeTokenStoreTag;
      const provider = yield* OidcProviderTag;
      const accounts = yield* AccountRepositoryTag;

      const pending = yield* tokens.consume(OIDC_STATE_PURPOSE, state).pipe(
        Effect.map(raw => JSON.parse(raw) as PendingAuthorization),
        Effect.catch(() => Effect.fail(new InvalidState())),
      );

      // A code the provider will not exchange, or a token that does not
      // verify, is a sign-in that did not authenticate anybody.
      const identity = yield* provider
        .exchangeCode({
          code,
          codeVerifier: pending.codeVerifier,
          nonce: pending.nonce,
        })
        .pipe(
          Effect.catchTags({
            Declined: () => Effect.fail(new Unauthenticated()),
            InvalidToken: () => Effect.fail(new Unauthenticated()),
            ExpiredToken: () => Effect.fail(new Unauthenticated()),
          }),
        );

      const subject = yield* resolveSignIn(accounts, provider.name, identity);
      const result = yield* establishSession(subject, readDevice(body));

      // Remembered so sign-out can end the provider's session too, and the
      // reverse index so a logout token's `sid` means something here.
      const idTokens = yield* IdTokenStoreTag;
      yield* idTokens.remember(result.sessionId, identity.idToken);
      if (identity.providerSessionId !== undefined) {
        const providerSessions = yield* ProviderSessionIndexTag;
        yield* providerSessions.link(
          identity.providerSessionId,
          result.sessionId,
        );
      }
      return { ...result, redirect: pending.redirect };
    }),
  ),
  implement(logout, ({ payload }) =>
    Effect.gen(function* () {
      const sessionId = asString(bodyOf(payload)['sessionId']);
      let idToken: string | undefined;
      if (sessionId !== undefined) {
        const sessions = yield* SessionStoreTag;
        const idTokens = yield* IdTokenStoreTag;
        idToken = yield* idTokens.take(sessionId);
        yield* sessions.revoke(sessionId);
      }
      const provider = yield* OidcProviderTag;
      const endSessionUrl = yield* provider.endSessionUrl(idToken);
      return { ok: true, endSessionUrl };
    }).pipe(Effect.catch(() => Effect.succeed({ ok: true }))),
  ),
  implement(backChannelLogout, ({ payload }) =>
    Effect.gen(function* () {
      const provider = yield* OidcProviderTag;
      const event = yield* provider
        .verifyLogoutToken(payload.logout_token)
        .pipe(
          Effect.catch(() =>
            Effect.fail(
              new InvalidRequest({ reason: 'the logout token did not verify' }),
            ),
          ),
        );

      const sessions = yield* SessionStoreTag;
      const idTokens = yield* IdTokenStoreTag;
      const providerSessions = yield* ProviderSessionIndexTag;
      const linked =
        event.providerSessionId === undefined
          ? []
          : yield* providerSessions.take(event.providerSessionId);
      for (const sessionId of linked) {
        yield* sessions.revoke(sessionId);
        yield* idTokens.take(sessionId);
      }

      // No `sid`, or one that resolved to nothing — which is also what a
      // lost index write looks like. Falling back to the subject keeps that
      // failure from becoming a session that quietly survives.
      if (linked.length === 0 && event.subject !== undefined) {
        const accounts = yield* AccountRepositoryTag;
        const user = yield* accounts.findByIdentifier(event.subject);
        if (user !== null) yield* sessions.revokeAllForUser(user.id);
      }
      return { ok: true };
    }),
  ),
  implement(providerEvents, ({ payload, headers }) =>
    Effect.gen(function* () {
      const verifier = yield* ProviderEventVerifierTag;
      const event = yield* verifier
        .verify(payload, headers)
        .pipe(Effect.catch(() => Effect.fail(new Unauthenticated())));
      if (event.revokesSessions) {
        const accounts = yield* AccountRepositoryTag;
        const user = yield* accounts.findByIdentifier(event.subject);
        if (user !== null) {
          const sessions = yield* SessionStoreTag;
          yield* sessions.revokeAllForUser(user.id);
        }
      }
      return { ok: true };
    }),
  ),
  implement(refresh, ({ payload }) =>
    Effect.gen(function* () {
      const sessionId = asString(bodyOf(payload)['sessionId']);
      if (sessionId === undefined) {
        return yield* new InvalidRequest({
          reason: 'a refresh names its session',
        });
      }
      const sessions = yield* SessionStoreTag;
      const tokens = yield* TokenServiceTag;

      // Revoked, idle past its window or at its ceiling: all one answer.
      const record = yield* sessions
        .touch(sessionId, SESSION_IDLE_TTL_SECONDS)
        .pipe(
          Effect.andThen(sessions.read(sessionId)),
          Effect.catchTag('NotFound', () => Effect.fail(new SessionExpired())),
        );
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
      return {
        accessToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        sessionExpiresIn: Math.max(
          0,
          Math.floor(
            (Date.parse(record.absoluteExpiresAt) - Date.now()) / 1000,
          ),
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
      };
    }),
  ),
  implement(resolveSession, ({ params }) =>
    resolveSessionUCFactory().pipe(
      Effect.provideService(SessionIdTag, params.sessionId),
      Effect.catchTag('NotFound', () => Effect.fail(new SessionUnresolved())),
    ),
  ),
] as const;
