import { createHmac, generateKeyPairSync } from 'node:crypto';

import { ConfigurationRepositoryTag } from '@entifix/business';
import { ConfigurationClientInMemory } from '@entifix/core';
import {
  makeZitadelActions,
  makeZitadelOidc,
  ZitadelActionsTag,
  type ZitadelManagement,
  ZitadelManagementTag,
  ZitadelOidcTag,
} from '@entifix/zitadel';
import {
  OidcProviderTag,
  ProviderDirectoryTag,
  ProviderEventVerifierTag,
  PublicKeySetTag,
} from '@r10c/business-ts-authn';
import {
  describeOidcProviderContract,
  describeProviderDirectoryContract,
  describeProviderEventVerifierContract,
  describePublicKeySetContract,
} from '@r10c/business-ts-authn/testing';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PublicKeySetLayer,
  zitadelDirectory,
  zitadelEventVerifier,
  zitadelOidcProvider,
  ZitadelProviderPortsLayer,
} from './zitadel-ports.js';

const ISSUER = 'https://zitadel.test';

/**
 * Zitadel's discovery document and token endpoint, served from memory: the
 * token endpoint refuses every code, because no code was ever issued here.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/openid-configuration')) {
      return Promise.resolve(
        Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/oauth/v2/authorize`,
          token_endpoint: `${ISSUER}/oauth/v2/token`,
          userinfo_endpoint: `${ISSUER}/oidc/v1/userinfo`,
          end_session_endpoint: `${ISSUER}/oidc/v1/end_session`,
          jwks_uri: `${ISSUER}/oauth/v2/keys`,
        }),
      );
    }
    if (url.endsWith('/oauth/v2/keys')) {
      return Promise.resolve(Response.json({ keys: [] }));
    }
    return Promise.resolve(
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describeOidcProviderContract('the Zitadel OIDC binding', () =>
  zitadelOidcProvider(
    makeZitadelOidc({
      issuer: ISSUER,
      clientId: 'client',
      redirectUri: 'https://r10c.test/callback',
      postLogoutRedirectUri: 'https://r10c.test/',
    }),
  ),
);

const SIGNING_KEY = 'action-signing-key';

describeProviderEventVerifierContract('the Zitadel Actions binding', () => ({
  verifier: zitadelEventVerifier(
    makeZitadelActions({ signingKey: SIGNING_KEY }),
  ),
  eventFor: (subject, endsSessions) =>
    JSON.stringify({
      event_type: endsSessions ? 'user.deactivated' : 'user.human.changed',
      aggregateID: subject,
    }),
  sign: rawBody => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const mac = createHmac('sha256', SIGNING_KEY)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    return { 'zitadel-signature': `t=${timestamp},v1=${mac}` };
  },
}));

/** Zitadel's management API, as far as the directory binding calls it. */
const managementOver = (): ZitadelManagement => {
  const users = new Map<string, string>();
  return {
    findUserByEmail: (email: string) =>
      Effect.succeed(
        users.has(email)
          ? {
              userId: users.get(email) as string,
              username: email,
              emailVerified: true,
              active: true,
            }
          : null,
      ),
    createHuman: (human: { readonly email: string }) =>
      Effect.sync(() => {
        users.set(human.email, `zitadel-${String(users.size + 1)}`);
        return users.get(human.email) as string;
      }),
  } as unknown as ZitadelManagement;
};

describeProviderDirectoryContract('the Zitadel directory binding', () =>
  zitadelDirectory(managementOver()),
);

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

describePublicKeySetContract('the published key set', () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* PublicKeySetTag;
    }).pipe(
      Effect.provide(
        PublicKeySetLayer.pipe(
          Layer.provide(
            Layer.succeed(
              ConfigurationRepositoryTag,
              new ConfigurationClientInMemory({
                jwt: [
                  {
                    key: 'publicKey',
                    value: publicKey
                      .export({ type: 'spki', format: 'pem' })
                      .toString(),
                  },
                  { key: 'keyId', value: 'dev-2026-08' },
                ],
              }),
            ),
          ),
        ),
      ),
    ),
  ),
);

describe('the Zitadel bindings beyond the contracts', () => {
  it('bind every provider port from the three Zitadel clients', async () => {
    const tags = await Effect.runPromise(
      Effect.all([
        OidcProviderTag,
        ProviderEventVerifierTag,
        ProviderDirectoryTag,
      ]).pipe(
        Effect.provide(
          ZitadelProviderPortsLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  ZitadelOidcTag,
                  makeZitadelOidc({
                    issuer: ISSUER,
                    clientId: 'c',
                    redirectUri: 'r',
                    postLogoutRedirectUri: 'p',
                  }),
                ),
                Layer.succeed(
                  ZitadelActionsTag,
                  makeZitadelActions({ signingKey: SIGNING_KEY }),
                ),
                Layer.succeed(ZitadelManagementTag, managementOver()),
              ),
            ),
          ),
        ),
      ),
    );

    expect(tags.map(port => (port as { name?: string }).name)).toEqual([
      'zitadel',
      undefined,
      'zitadel',
    ]);
  });

  it('reports a key set it cannot publish as a store failure', async () => {
    const failed = await Effect.runPromise(
      Effect.flip(
        Effect.gen(function* () {
          return yield* (yield* PublicKeySetTag).jwks();
        }).pipe(
          Effect.provide(
            PublicKeySetLayer.pipe(
              Layer.provide(
                Layer.succeed(
                  ConfigurationRepositoryTag,
                  new ConfigurationClientInMemory({
                    jwt: [
                      { key: 'publicKey', value: 'not a pem' },
                      { key: 'keyId', value: 'k' },
                    ],
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    expect(failed).toMatchObject({ message: 'Failed to publish the key set' });
  });
});
