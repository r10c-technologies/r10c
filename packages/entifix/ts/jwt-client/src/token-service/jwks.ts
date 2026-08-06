import { exportJWK, importSPKI, type JSONWebKeySet } from 'jose';

import { TOKEN_ALGORITHM } from './jose-token-service.js';

/**
 * The service's public signing key as a JWK Set, ready to serve at
 * `/.well-known/jwks.json`.
 *
 * Services in this fleet do **not** need it: each resolves `jwt.publicKey` from
 * config-service at boot and verifies locally, so no verification depends on
 * the minting service being reachable. The endpoint exists for the consumers
 * that cannot do that — a browser or edge runtime holding no fleet
 * configuration — and because publishing a key set is the interoperable shape
 * every OIDC client already knows how to consume.
 *
 * Serving it unauthenticated is the point: a public key is public, and
 * withholding it protects nothing while breaking every standard client.
 */
export const publicJwks = async (
  publicKeyPem: string,
  keyId: string,
): Promise<JSONWebKeySet> => {
  const key = await importSPKI(publicKeyPem, TOKEN_ALGORITHM);
  return {
    keys: [
      {
        ...(await exportJWK(key)),
        kid: keyId,
        // `use` and `alg` are advisory, and they are what stop a client from
        // trying this key for encryption or for an algorithm it was never
        // issued for.
        use: 'sig',
        alg: TOKEN_ALGORITHM,
      },
    ],
  };
};
