import type { TransitionalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * Who the provider says signed in, from a verified `id_token`. Provider-shaped
 * rather than Zitadel-shaped: these are the OIDC claims any provider issues.
 */
export interface ProviderIdentity {
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  readonly preferredUsername?: string;
  readonly displayName?: string;
  /** The provider's own session (`sid`), which a back-channel logout names. */
  readonly providerSessionId?: string;
  /** Kept so sign-out can end the provider's session too. */
  readonly idToken: string;
}

/** The secrets one sign-in is bound by, minted before the browser leaves. */
export interface ProviderAuthorization {
  /** The PKCE verifier. It never leaves the server. */
  readonly codeVerifier: string;
  /** Its S256 challenge, which is what the provider is shown. */
  readonly codeChallenge: string;
  /** Binds the returned `id_token` to this request. */
  readonly nonce: string;
}

/** What a verified back-channel logout token names. */
export interface ProviderLogout {
  readonly providerSessionId?: string;
  readonly subject?: string;
}

/**
 * The identity provider's OIDC surface: a sign-in started, a code exchanged
 * for a verified identity, a provider session ended, and a logout token the
 * provider sent verified.
 *
 * ⚠️ **Verification is the implementation's job and the whole point of it.**
 * `exchangeCode` answers only an identity whose `id_token` was signed by the
 * provider and carries the nonce it was given, and `verifyLogoutToken` only a
 * token signed by the provider that is not an `id_token` replayed at it
 * (ADR 0017). A route trusts what these answer.
 */
export interface OidcProvider {
  /** Stamped on the identifier rows this provider owns. */
  readonly name: string;
  readonly newAuthorization: () => Effect.Effect<ProviderAuthorization>;
  readonly authorizationUrl: (input: {
    readonly state: string;
    readonly nonce: string;
    readonly codeChallenge: string;
    readonly uiLocales?: string;
  }) => Effect.Effect<string, TransitionalFailure>;
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly codeVerifier: string;
    readonly nonce: string;
  }) => Effect.Effect<ProviderIdentity, TransitionalFailure>;
  readonly endSessionUrl: (
    idToken: string | undefined,
  ) => Effect.Effect<string, TransitionalFailure>;
  readonly verifyLogoutToken: (
    logoutToken: string,
  ) => Effect.Effect<ProviderLogout, TransitionalFailure>;
}

export class OidcProviderTag extends Context.Service<
  OidcProviderTag,
  OidcProvider
>()('OidcProviderTag') {}

/** What a verified provider event says about one user. */
export interface ProviderEvent {
  readonly subject: string;
  /** Whether the event means every session the subject holds must end. */
  readonly revokesSessions: boolean;
}

/**
 * The provider telling r10c a user's standing changed (ADR 0019). `verify`
 * authenticates the raw body against the request's headers — over the bytes
 * as sent, never a re-serialisation — and fails on anything it cannot.
 */
export interface ProviderEventVerifier {
  readonly verify: (
    rawBody: string,
    headers: Readonly<Record<string, string | undefined>>,
  ) => Effect.Effect<ProviderEvent, TransitionalFailure>;
}

export class ProviderEventVerifierTag extends Context.Service<
  ProviderEventVerifierTag,
  ProviderEventVerifier
>()('ProviderEventVerifierTag') {}

/** A human the provider is asked to hold, for an account r10c created. */
export interface ProviderHuman {
  readonly username: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly givenName: string;
  readonly familyName: string;
  readonly displayName?: string;
  readonly password?: string;
}

/**
 * The provider's user directory, as far as r10c writes it: find a human by
 * address, or create one. Each field has one writer (ADR 0016), and these are
 * the provider's.
 */
export interface ProviderDirectory {
  /** Stamped on the identifier rows this provider owns. */
  readonly name: string;
  readonly findUserIdByEmail: (
    email: string,
  ) => Effect.Effect<string | undefined, TransitionalFailure>;
  readonly createHuman: (
    human: ProviderHuman,
  ) => Effect.Effect<string, TransitionalFailure>;
}

export class ProviderDirectoryTag extends Context.Service<
  ProviderDirectoryTag,
  ProviderDirectory
>()('ProviderDirectoryTag') {}

/** A JSON Web Key Set, as served at `/.well-known/jwks.json`. */
export interface PublicKeySetDocument {
  readonly keys: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/**
 * The public half of r10c's token-signing key, for a consumer that holds no
 * fleet configuration. Public by design; it must never carry a private member.
 */
export interface PublicKeySet {
  readonly jwks: () => Effect.Effect<PublicKeySetDocument, TransitionalFailure>;
}

export class PublicKeySetTag extends Context.Service<
  PublicKeySetTag,
  PublicKeySet
>()('PublicKeySetTag') {}

/** One notice a development mailbox holds. */
export interface MailboxNotice {
  readonly kind: string;
  readonly to: string;
  readonly userId: string;
  readonly data: Readonly<Record<string, string>>;
  readonly sentAt: string;
}

/**
 * What the development notification port has sent, newest first — the record
 * that lets a journey whose link is never returned in a response be tested end
 * to end. Served only outside production.
 */
export interface DevMailbox {
  readonly read: (
    to: string | undefined,
  ) => Effect.Effect<readonly MailboxNotice[], TransitionalFailure>;
}

export class DevMailboxTag extends Context.Service<DevMailboxTag, DevMailbox>()(
  'DevMailboxTag',
) {}
