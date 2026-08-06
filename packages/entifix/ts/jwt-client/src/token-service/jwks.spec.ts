import { exportSPKI, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';

import { TOKEN_ALGORITHM } from './jose-token-service.js';
import { publicJwks } from './jwks.js';

const publicKeyPem = await generateKeyPair(TOKEN_ALGORITHM, {
  extractable: true,
}).then(({ publicKey }) => exportSPKI(publicKey));

describe('publicJwks', () => {
  it('publishes the public key under its key id', async () => {
    const jwks = await publicJwks(publicKeyPem, 'dev-2026-08');

    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({
      kty: 'RSA',
      kid: 'dev-2026-08',
      use: 'sig',
      alg: TOKEN_ALGORITHM,
    });
  });

  it('publishes no private material', async () => {
    const jwks = await publicJwks(publicKeyPem, 'dev-2026-08');

    // `d` is the RSA private exponent. Its presence would mean the endpoint
    // hands out the signing key to anyone who asks.
    expect(jwks.keys[0]).not.toHaveProperty('d');
    expect(jwks.keys[0]).toHaveProperty('n');
    expect(jwks.keys[0]).toHaveProperty('e');
  });
});
