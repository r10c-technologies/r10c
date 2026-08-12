import { createHmac } from 'node:crypto';

import { EntifixLogicError } from '@r10c/entifix-ts-core';
import type {
  LogoutEvent,
  ZitadelIdentity,
  ZitadelManagement,
  ZitadelOidc,
  ZitadelUser,
} from '@r10c/entifix-ts-zitadel-client';
import { Effect } from 'effect';

/** Where the fake hosted UI pretends to live. Nothing ever fetches it. */
export const MOCK_ISSUER = 'https://zitadel.mock';

/**
 * The provider session a sign-in belongs to, one per person.
 *
 * Constant per address rather than per sign-in, because that is what a real
 * hosted UI does: a browser that is already authenticated gets the same `sid`
 * back. It is also the only way the sid-scoped revocation is worth testing —
 * one logout token has to be able to end two r10c sessions at once.
 */
export const providerSessionIdFor = (email: string) =>
  `sid-${email.toLowerCase()}`;

/**
 * The `sub` this directory reports for an address — the same value the service
 * records as the account's `external-subject` identifier, which is what the
 * `sub`-only revocation path resolves against.
 */
export const providerSubjectFor = (email: string) =>
  `zitadel-${email.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`;

/** How a spec hands the fake a logout token. See {@link makeFakeZitadel}. */
export const mockLogoutToken = (event: LogoutEvent): string =>
  JSON.stringify(event);

/**
 * The Actions v2 signing key the mock service is wired with.
 *
 * Unlike the OIDC half, the action webhook is **not** faked: its verifier needs
 * only a shared string, so the suite runs the shipped HMAC code and signs its
 * payloads the way Zitadel does. That makes the signature boundary — the only
 * authentication that endpoint has — a thing these journeys actually exercise
 * rather than a thing they mock away.
 */
export const MOCK_ACTION_SIGNING_KEY = 'mock-action-signing-key';

/** The body Zitadel POSTs for a user event, of which two fields matter. */
export const mockActionPayload = (eventType: string, subject: string): string =>
  JSON.stringify({
    aggregateID: subject,
    aggregateType: 'user',
    resourceOwner: 'mock-org',
    instanceID: 'mock-instance',
    version: 'v2',
    sequence: 1,
    event_type: eventType,
    created_at: new Date().toISOString(),
    event_payload: {},
  });

/** `t=<unix>,v1=<hex>`, computed exactly as `pkg/actions/signing.go` does. */
export const mockActionSignature = (
  rawBody: string,
  key: string = MOCK_ACTION_SIGNING_KEY,
  at: number = Math.floor(Date.now() / 1000),
): string =>
  `t=${String(at)},v1=${createHmac('sha256', key)
    .update(`${String(at)}.${rawBody}`)
    .digest('hex')}`;

/**
 * An in-memory Zitadel: a management API and an OIDC client over one directory.
 *
 * They share the directory on purpose. The service's boot seeds humans through
 * the management half, and a sign-in then arrives through the OIDC half — if the
 * two held separate state, a seeded user would provision one subject and sign in
 * as another, and every authorization journey would silently run as a freshly
 * created `user` instead of the seeded role it means to test.
 *
 * The `code` a spec posts to the callback **is the email** of whoever is
 * signing in. That keeps the fake honest about the one thing it is standing in
 * for — "the provider says this person authenticated" — without pretending to
 * model a hosted login page. Protocol correctness (PKCE, nonce binding, the
 * pinned `alg`) is covered where it belongs, in the client's own unit tests.
 */
export const makeFakeZitadel = () => {
  const byId = new Map<string, ZitadelUser>();
  const idByEmail = new Map<string, string>();

  const idFor = providerSubjectFor;

  const management: ZitadelManagement = {
    findUserByEmail: email =>
      Effect.sync(() => {
        const id = idByEmail.get(email.toLowerCase());
        return id === undefined ? null : (byId.get(id) ?? null);
      }),
    getUser: userId => Effect.sync(() => byId.get(userId) ?? null),
    createHuman: input =>
      Effect.sync(() => {
        const userId = idFor(input.email);
        byId.set(userId, {
          userId,
          username: input.username,
          email: input.email,
          emailVerified: input.emailVerified ?? false,
          displayName:
            input.displayName ?? `${input.givenName} ${input.familyName}`,
          active: true,
        });
        idByEmail.set(input.email.toLowerCase(), userId);
        return userId;
      }),
    updateProfile: (userId, profile) =>
      Effect.sync(() => {
        const existing = byId.get(userId);
        if (existing === undefined) return;
        byId.set(userId, {
          ...existing,
          displayName:
            profile.displayName ?? `${profile.givenName} ${profile.familyName}`,
        });
      }),
    setActive: (userId, active) =>
      Effect.sync(() => {
        const existing = byId.get(userId);
        if (existing !== undefined) byId.set(userId, { ...existing, active });
      }),
    deleteUser: userId =>
      Effect.sync(() => {
        const existing = byId.get(userId);
        if (existing === undefined) return;
        byId.delete(userId);
        idByEmail.delete(existing.email?.toLowerCase() ?? '');
      }),
  };

  /**
   * Addresses the directory should report as **unverified**, so a spec can drive
   * the linking-vector case without a second sign-in mechanism.
   */
  const unverified = new Set<string>();

  const oidc: ZitadelOidc = {
    authorizationUrl: input =>
      Effect.sync(() => {
        const url = new URL(`${MOCK_ISSUER}/oauth/v2/authorize`);
        url.searchParams.set('state', input.state);
        url.searchParams.set('nonce', input.nonce);
        url.searchParams.set('code_challenge', input.codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        return url.toString();
      }),
    exchangeCode: input =>
      Effect.sync(() => {
        const email = input.code.toLowerCase();
        const known = byId.get(idByEmail.get(email) ?? '');
        // An unknown address is somebody who just signed themselves up through
        // the hosted UI — the auto-provisioning path, which is exactly what the
        // callback spec needs to be able to reach.
        const identity: ZitadelIdentity = {
          subject: known?.userId ?? idFor(email),
          email,
          emailVerified: unverified.has(email)
            ? false
            : (known?.emailVerified ?? true),
          preferredUsername: known?.username ?? email,
          displayName: known?.displayName,
          providerSessionId: providerSessionIdFor(email),
          idToken: `id-token-for:${email}`,
        };
        return identity;
      }),
    endSessionUrl: idToken =>
      Effect.sync(() => {
        const url = new URL(`${MOCK_ISSUER}/oidc/v1/end_session`);
        if (idToken !== undefined)
          url.searchParams.set('id_token_hint', idToken);
        return url.toString();
      }),
    // Same bargain as `exchangeCode`: the token *is* its payload, JSON rather
    // than a signed JWT. What a spec at this level is checking is that a
    // verified logout event revokes the right sessions — the signature, the
    // pinned `alg`, the `events` claim and the anti-replay `nonce` check all
    // live in the client's own unit tests, where a real key pair is available.
    verifyLogoutToken: logoutToken =>
      Effect.try({
        try: () => JSON.parse(logoutToken) as LogoutEvent,
        catch: () => new EntifixLogicError('the logout_token did not parse'),
      }).pipe(
        Effect.flatMap(event =>
          event.providerSessionId === undefined && event.subject === undefined
            ? Effect.fail(
                new EntifixLogicError(
                  'the logout_token names neither sid nor sub',
                ),
              )
            : Effect.succeed(event),
        ),
      ),
  };

  return { management, oidc, byId, idByEmail, unverified };
};
