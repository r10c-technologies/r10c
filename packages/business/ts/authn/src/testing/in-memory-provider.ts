import { createHash, createHmac, randomBytes } from 'node:crypto';

import { EntifixLogicError } from '@entifix/core';
import { Effect } from 'effect';

import type {
  OidcProvider,
  ProviderDirectory,
  ProviderIdentity,
  ProviderLogout,
  PublicKeySet,
  PublicKeySetDocument,
} from '../repository/identity-provider-ports';
import type { ProviderEventSubject } from './identity-provider-ports.contract';

const ISSUER = 'https://provider.test';

/**
 * An {@link OidcProvider} that answers the codes and logout tokens it was
 * scripted with, for the specs of whatever drives a sign-in. It runs
 * `describeOidcProviderContract`, so its secrets and URLs are shaped exactly
 * as a real provider's are.
 */
export const makeScriptedOidcProvider = (
  script: {
    readonly identities?: Readonly<Record<string, ProviderIdentity>>;
    readonly logouts?: Readonly<Record<string, ProviderLogout>>;
  } = {},
): OidcProvider => {
  const refuse = (what: string) =>
    Effect.fail(new EntifixLogicError(`the provider never issued ${what}`));
  const withParams = (path: string, params: Record<string, string>) => {
    const url = new URL(path, ISSUER);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    return url.toString();
  };

  return {
    name: 'scripted',
    newAuthorization: () =>
      Effect.sync(() => {
        const codeVerifier = randomBytes(32).toString('base64url');
        return {
          codeVerifier,
          codeChallenge: createHash('sha256')
            .update(codeVerifier)
            .digest('base64url'),
          nonce: randomBytes(16).toString('base64url'),
        };
      }),
    authorizationUrl: ({ state, nonce, codeChallenge, uiLocales }) =>
      Effect.succeed(
        withParams('/authorize', {
          state,
          nonce,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          ...(uiLocales === undefined ? {} : { ui_locales: uiLocales }),
        }),
      ),
    exchangeCode: ({ code }) => {
      const identity = script.identities?.[code];
      return identity === undefined
        ? refuse('that code')
        : Effect.succeed(identity);
    },
    endSessionUrl: idToken =>
      Effect.succeed(
        withParams(
          '/end_session',
          idToken === undefined ? {} : { id_token_hint: idToken },
        ),
      ),
    verifyLogoutToken: token => {
      const logout = script.logouts?.[token];
      return logout === undefined
        ? refuse('that logout token')
        : Effect.succeed(logout);
    },
  };
};

const SIGNATURE_HEADER = 'x-provider-signature';

/**
 * A provider event verifier over a shared secret, with its signer, for the
 * specs of whatever acts on a provider event. It runs
 * `describeProviderEventVerifierContract`.
 */
export const makeInMemoryProviderEvents = (
  secret = 'provider-secret',
): ProviderEventSubject => {
  const macOf = (rawBody: string) =>
    createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    eventFor: (subject, endsSessions) =>
      JSON.stringify({ subject, endsSessions }),
    sign: rawBody => ({ [SIGNATURE_HEADER]: macOf(rawBody) }),
    verifier: {
      verify: (rawBody, headers) =>
        Effect.suspend(() => {
          if (headers[SIGNATURE_HEADER] !== macOf(rawBody)) {
            return Effect.fail(
              new EntifixLogicError('the provider event did not verify'),
            );
          }
          const { subject, endsSessions } = JSON.parse(rawBody) as {
            subject: string;
            endsSessions: boolean;
          };
          return Effect.succeed({ subject, revokesSessions: endsSessions });
        }),
    },
  };
};

/**
 * A {@link ProviderDirectory} held in memory, for the specs of whatever
 * provisions an account. It runs `describeProviderDirectoryContract`.
 */
export const makeInMemoryProviderDirectory = (): ProviderDirectory => {
  const humans = new Map<string, string>();
  return {
    name: 'in-memory',
    findUserIdByEmail: email => Effect.sync(() => humans.get(email)),
    createHuman: human =>
      Effect.sync(() => {
        const id = `provider-${String(humans.size + 1)}`;
        humans.set(human.email, id);
        return id;
      }),
  };
};

/**
 * A {@link PublicKeySet} serving a fixed set, for the specs of whatever serves
 * the JWKS route. It runs `describePublicKeySetContract`.
 */
export const makeStaticPublicKeySet = (
  document: PublicKeySetDocument = {
    keys: [{ kty: 'RSA', kid: 'test-key', alg: 'RS256', use: 'sig', n: 'n', e: 'AQAB' }],
  },
): PublicKeySet => ({ jwks: () => Effect.succeed(document) });
