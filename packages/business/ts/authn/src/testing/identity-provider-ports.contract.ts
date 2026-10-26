import { createHash } from 'node:crypto';

import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  OidcProvider,
  ProviderDirectory,
  ProviderEventVerifier,
  PublicKeySet,
} from '../repository/identity-provider-ports';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const refused = async <A, E>(effect: Effect.Effect<A, E>) =>
  Exit.isFailure(await Effect.runPromiseExit(effect));

/**
 * What every {@link OidcProvider} must guarantee before any network is
 * involved, and what it must refuse:
 * - each sign-in is bound by fresh secrets, the challenge being the RFC 7636
 *   S256 of the verifier — the verifier itself is never shown;
 * - the authorization URL carries the state, the nonce, the S256 challenge
 *   and, when asked, the UI locale;
 * - a code or a logout token the provider never issued is refused, never
 *   answered with an identity.
 *
 * `make` returns a subject whose provider issued nothing yet.
 */
export const describeOidcProviderContract = (
  name: string,
  make: () => OidcProvider | Promise<OidcProvider>,
) => {
  describe(`${name} honours the OidcProvider contract`, () => {
    it('binds each sign-in by fresh secrets, showing only the S256 challenge', async () => {
      const provider = await make();

      const first = await run(provider.newAuthorization());
      const second = await run(provider.newAuthorization());

      expect(first.codeChallenge).toBe(
        createHash('sha256').update(first.codeVerifier).digest('base64url'),
      );
      expect(first.codeVerifier).not.toBe(second.codeVerifier);
      expect(first.nonce).not.toBe(second.nonce);
      expect(first.nonce.length).toBeGreaterThanOrEqual(16);
    });

    it('carries the state, the nonce, the challenge and the locale to the provider', async () => {
      const provider = await make();

      const url = new URL(
        await run(
          provider.authorizationUrl({
            state: 'the-state',
            nonce: 'the-nonce',
            codeChallenge: 'the-challenge',
            uiLocales: 'es-GT',
          }),
        ),
      );
      const bare = new URL(
        await run(
          provider.authorizationUrl({
            state: 's',
            nonce: 'n',
            codeChallenge: 'c',
          }),
        ),
      );

      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        state: 'the-state',
        nonce: 'the-nonce',
        code_challenge: 'the-challenge',
        code_challenge_method: 'S256',
        ui_locales: 'es-GT',
      });
      expect(bare.searchParams.has('ui_locales')).toBe(false);
    });

    it('answers no identity for a code it never issued, and verifies no forged logout', async () => {
      const provider = await make();

      expect(
        await refused(
          provider.exchangeCode({
            code: 'never-issued',
            codeVerifier: 'v',
            nonce: 'n',
          }),
        ),
      ).toBe(true);
      expect(await refused(provider.verifyLogoutToken('not.a.token'))).toBe(
        true,
      );
    });

    it('ends the provider session, naming the id token when there is one', async () => {
      const provider = await make();

      const hinted = new URL(await run(provider.endSessionUrl('the-id-token')));
      const bare = new URL(await run(provider.endSessionUrl(undefined)));

      expect(hinted.searchParams.get('id_token_hint')).toBe('the-id-token');
      expect(bare.searchParams.has('id_token_hint')).toBe(false);
    });
  });
};

/**
 * A verifier under test, a way to write an event the way its provider does,
 * and a way to sign one the way its provider does.
 */
export interface ProviderEventSubject {
  readonly verifier: ProviderEventVerifier;
  readonly eventFor: (subject: string, endsSessions: boolean) => string;
  readonly sign: (
    rawBody: string,
  ) => Readonly<Record<string, string | undefined>>;
}

/**
 * What every {@link ProviderEventVerifier} must guarantee: an event signed by
 * the provider over these exact bytes is read, with whether it ends the
 * subject's sessions, and anything else — unsigned, signed over other bytes —
 * is refused.
 *
 * `make` returns a subject and its signer.
 */
export const describeProviderEventVerifierContract = (
  name: string,
  make: () => ProviderEventSubject | Promise<ProviderEventSubject>,
) => {
  describe(`${name} honours the ProviderEventVerifier contract`, () => {
    it('reads a signed event, and whether it ends the sessions', async () => {
      const { verifier, sign, eventFor } = await make();
      const deactivated = eventFor('sub-1', true);
      const renamed = eventFor('sub-1', false);

      expect(
        await run(verifier.verify(deactivated, sign(deactivated))),
      ).toEqual({ subject: 'sub-1', revokesSessions: true });
      expect(
        await run(verifier.verify(renamed, sign(renamed))),
      ).toEqual({ subject: 'sub-1', revokesSessions: false });
    });

    it('refuses an unsigned event, and one signed over other bytes', async () => {
      const { verifier, sign, eventFor } = await make();
      const body = eventFor('sub-1', true);

      expect(await refused(verifier.verify(body, {}))).toBe(true);
      expect(
        await refused(verifier.verify(`${body} `, sign(body))),
      ).toBe(true);
    });
  });
};

/**
 * What every {@link ProviderDirectory} must guarantee: a human it was asked
 * to create is found by address afterwards, under the id creating it
 * answered, and an address it holds nobody for finds nobody.
 *
 * `make` returns an empty directory.
 */
export const describeProviderDirectoryContract = (
  name: string,
  make: () => ProviderDirectory | Promise<ProviderDirectory>,
) => {
  describe(`${name} honours the ProviderDirectory contract`, () => {
    it('finds a human it created, by address, and nobody else', async () => {
      const directory = await make();

      const created = await run(
        directory.createHuman({
          username: 'ada',
          email: 'ada@example.com',
          emailVerified: true,
          givenName: 'Ada',
          familyName: 'Lovelace',
        }),
      );

      expect(created).toEqual(expect.any(String));
      expect(await run(directory.findUserIdByEmail('ada@example.com'))).toBe(
        created,
      );
      expect(
        await run(directory.findUserIdByEmail('nobody@example.com')),
      ).toBeUndefined();
      expect(directory.name).toEqual(expect.any(String));
    });
  });
};

/** Members of a JSON Web Key that would carry private key material. */
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];

/**
 * What every {@link PublicKeySet} must guarantee: at least one key, each
 * naming its `kid` and type, and **no member that carries private material**
 * — the set is served unauthenticated.
 *
 * `make` returns a subject serving the fleet's signing key.
 */
export const describePublicKeySetContract = (
  name: string,
  make: () => PublicKeySet | Promise<PublicKeySet>,
) => {
  describe(`${name} honours the PublicKeySet contract`, () => {
    it('serves named public keys and nothing private', async () => {
      const { keys } = await run((await make()).jwks());

      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).toMatchObject({
          kid: expect.any(String),
          kty: expect.any(String),
        });
        for (const member of PRIVATE_MEMBERS) {
          expect(key).not.toHaveProperty(member);
        }
      }
    });
  });
};
