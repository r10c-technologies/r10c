import { ConfigurationRepositoryTag } from '@entifix/business';
import { EntifixConnError } from '@entifix/core';
import { publicJwks } from '@entifix/jwt';
import {
  ACTION_SIGNATURE_HEADER,
  createOpaqueValue,
  createPkcePair,
  type ZitadelActions,
  ZitadelActionsTag,
  type ZitadelManagement,
  ZitadelManagementTag,
  type ZitadelOidc,
  ZitadelOidcTag,
} from '@entifix/zitadel';
import {
  type OidcProvider,
  OidcProviderTag,
  type ProviderDirectory,
  ProviderDirectoryTag,
  type ProviderEventVerifier,
  ProviderEventVerifierTag,
  type PublicKeySetDocument,
  PublicKeySetTag,
} from '@r10c/business-ts-authn';
import { DevMailboxLayer } from '@r10c/implementation-auth-mongo';
import { DevSurfaceEnabledTag } from '@r10c/implementation-authn-http';
import { Effect, Layer } from 'effect';

/** Stamped on the identifier rows Zitadel owns, so their origin is readable. */
export const PROVIDER = 'zitadel';

/** The OIDC surface, over Zitadel's client and its PKCE helpers. */
export const zitadelOidcProvider = (oidc: ZitadelOidc): OidcProvider => ({
  name: PROVIDER,
  newAuthorization: () =>
    Effect.sync(() => ({ ...createPkcePair(), nonce: createOpaqueValue() })),
  authorizationUrl: input => oidc.authorizationUrl(input),
  exchangeCode: input => oidc.exchangeCode(input),
  endSessionUrl: idToken => oidc.endSessionUrl(idToken),
  verifyLogoutToken: token => oidc.verifyLogoutToken(token),
});

/** Zitadel's Actions v2 webhook, read from the header Zitadel signs it in. */
export const zitadelEventVerifier = (
  actions: ZitadelActions,
): ProviderEventVerifier => ({
  verify: (rawBody, headers) =>
    actions.verifyEvent(rawBody, headers[ACTION_SIGNATURE_HEADER]).pipe(
      Effect.map(({ subject, revokesSessions }) => ({
        subject,
        revokesSessions,
      })),
    ),
});

/** The user directory, over Zitadel's management API. */
export const zitadelDirectory = (
  management: ZitadelManagement,
): ProviderDirectory => ({
  name: PROVIDER,
  findUserIdByEmail: email =>
    management.findUserByEmail(email).pipe(Effect.map(user => user?.userId)),
  createHuman: human =>
    management.createHuman({ ...human, passwordChangeRequired: false }),
});

/**
 * The public half of the signing key, read from this service's configuration
 * on each request and published through jose — which derives the set from the
 * public PEM alone, so no path here can reach the private half.
 */
export const PublicKeySetLayer = Layer.effect(
  PublicKeySetTag,
  Effect.map(ConfigurationRepositoryTag, store => ({
    jwks: () =>
      Effect.gen(function* () {
        const publicKeyPem = yield* store.in('jwt').getString('publicKey');
        const keyId = yield* store.in('jwt').getString('keyId');
        return (yield* Effect.tryPromise({
          try: () => publicJwks(publicKeyPem, keyId),
          catch: error =>
            new EntifixConnError('Failed to publish the key set', error),
        })) as unknown as PublicKeySetDocument;
      }),
  })),
);

/** Zitadel's three clients, bound to the identity-provider ports. */
export const ZitadelProviderPortsLayer = Layer.mergeAll(
  Layer.effect(
    OidcProviderTag,
    Effect.map(ZitadelOidcTag, zitadelOidcProvider),
  ),
  Layer.effect(
    ProviderEventVerifierTag,
    Effect.map(ZitadelActionsTag, zitadelEventVerifier),
  ),
  Layer.effect(
    ProviderDirectoryTag,
    Effect.map(ZitadelManagementTag, zitadelDirectory),
  ),
);

/**
 * Everything the `authn/http` cell's routes need that this host decides: the
 * provider ports over Zitadel, the published key set, the development mailbox,
 * and whether the development surface is served at all.
 */
export const AuthnHostLayer = Layer.mergeAll(
  ZitadelProviderPortsLayer,
  PublicKeySetLayer,
  DevMailboxLayer,
  Layer.succeed(DevSurfaceEnabledTag, process.env.NODE_ENV !== 'production'),
);
