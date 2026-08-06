import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  type JoseTokenServiceOptions,
  signAccessToken,
  TOKEN_ALGORITHM,
} from './jose-token-service.js';
import { unverifiedClaims, unverifiedRoles } from './unverified-claims.js';

const keyPair = async (): Promise<
  Pick<JoseTokenServiceOptions, 'privateKeyPem' | 'publicKeyPem'>
> => {
  const { privateKey, publicKey } = await generateKeyPair(TOKEN_ALGORITHM, {
    extractable: true,
  });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
};

const options: JoseTokenServiceOptions = {
  ...(await keyPair()),
  keyId: 'spec-key',
  issuer: 'spec-issuer',
  audience: 'spec-audience',
};

/** A token from a key this fleet has never heard of. */
const foreignOptions: JoseTokenServiceOptions = {
  ...options,
  ...(await keyPair()),
  keyId: 'a-key-nobody-trusts',
};

describe('unverifiedClaims', () => {
  it('reads the claims out of a real token', async () => {
    const token = await signAccessToken(
      {
        userId: 'user-1',
        subject: 'user-1',
        sessionId: 'session-1',
        roles: ['admin'],
      },
      options,
      60,
    );

    expect(unverifiedClaims(token)).toMatchObject({
      userId: 'user-1',
      roles: ['admin'],
    });
  });

  // The whole point of the warning: it does not check the signature, so a token
  // signed by an untrusted key still parses. Presentation only.
  it('reads claims from a token signed with the wrong key', async () => {
    const token = await signAccessToken(
      {
        userId: 'user-2',
        subject: 'user-2',
        sessionId: 'session-2',
        roles: ['super-admin'],
      },
      foreignOptions,
      60,
    );

    expect(unverifiedClaims(token)?.roles).toEqual(['super-admin']);
  });

  it('returns undefined for something that is not a JWT', () => {
    expect(unverifiedClaims('not-a-token')).toBeUndefined();
  });

  it('returns undefined when the payload is not decodable', () => {
    expect(unverifiedClaims('a.!!!not-base64!!!.c')).toBeUndefined();
  });

  it('returns undefined when the payload is not an object', () => {
    const payload = Buffer.from('42').toString('base64url');
    expect(unverifiedClaims(`a.${payload}.c`)).toBeUndefined();
  });
});

describe('unverifiedRoles', () => {
  it('is empty without a token', () => {
    expect(unverifiedRoles(undefined)).toEqual([]);
  });

  it('is empty for an unparseable token', () => {
    expect(unverifiedRoles('nonsense')).toEqual([]);
  });

  it('is empty when the payload carries no roles', () => {
    const payload = Buffer.from(JSON.stringify({ userId: 'u' })).toString(
      'base64url',
    );
    expect(unverifiedRoles(`a.${payload}.c`)).toEqual([]);
  });

  it('returns the roles claim', async () => {
    const token = await signAccessToken(
      {
        userId: 'user-1',
        subject: 'user-1',
        sessionId: 'session-1',
        roles: ['user'],
      },
      options,
      60,
    );

    expect(unverifiedRoles(token)).toEqual(['user']);
  });
});
