import type { TokenClaims } from '@r10c/entifix-ts-business';
import { run, runFailure } from '@r10c/entifix-ts-testing-unit';
import { exportPKCS8, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  type JoseTokenServiceOptions,
  makeJoseTokenService,
  signAccessToken,
  TOKEN_ALGORITHM,
  verifyAccessToken,
} from './jose-token-service.js';

/** A throwaway RSA pair per suite — no key material belongs in a spec file. */
const generatePem = async (): Promise<{
  privateKeyPem: string;
  publicKeyPem: string;
}> => {
  const { privateKey, publicKey } = await generateKeyPair(TOKEN_ALGORITHM, {
    extractable: true,
  });
  return {
    privateKeyPem: await exportPKCS8(privateKey),
    publicKeyPem: await exportSPKI(publicKey),
  };
};

const pair = await generatePem();
const foreignPair = await generatePem();

const options: JoseTokenServiceOptions = {
  ...pair,
  keyId: 'test-key',
  issuer: 'r10c-auth',
  audience: 'r10c-fleet',
};

const claims: TokenClaims = {
  userId: 'user-1',
  subject: 'sub-1',
  sessionId: 'sess-1',
  roles: ['admin'],
  partyRole: 'vendor',
};

describe('jose token service', () => {
  it('round-trips claims through sign and verify', async () => {
    const service = makeJoseTokenService(options);

    const token = await run(service.sign(claims, 900));
    const verified = await run(service.verify(token));

    expect(verified.userId).toBe('user-1');
    expect(verified.subject).toBe('sub-1');
    expect(verified.sessionId).toBe('sess-1');
    expect(verified.roles).toEqual(['admin']);
    expect(verified.partyRole).toBe('vendor');
    expect(verified['iss']).toBe('r10c-auth');
    expect(verified['aud']).toBe('r10c-fleet');
  });

  it('stamps the key id, so a verifier can tell which key signed', async () => {
    const token = await signAccessToken(claims, options, 900);

    const header = JSON.parse(
      Buffer.from(token.split('.')[0] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;

    expect(header['alg']).toBe(TOKEN_ALGORITHM);
    expect(header['kid']).toBe('test-key');
  });

  it('verifyAccessToken is usable as a bare promise (edge/middleware path)', async () => {
    const token = await signAccessToken(claims, options, 900);

    const verified = await verifyAccessToken(token, options);

    expect(verified.sessionId).toBe('sess-1');
  });

  it('verifies with the public key alone', async () => {
    const token = await signAccessToken(claims, options, 900);
    const verifier = makeJoseTokenService({
      publicKeyPem: pair.publicKeyPem,
      keyId: 'test-key',
      issuer: options.issuer,
      audience: options.audience,
    });

    const verified = await run(verifier.verify(token));

    expect(verified.userId).toBe('user-1');
  });

  it('refuses to sign without a private key, as a build error', async () => {
    const verifier = makeJoseTokenService({
      publicKeyPem: pair.publicKeyPem,
      keyId: 'test-key',
      issuer: options.issuer,
      audience: options.audience,
    });

    const error = await runFailure(verifier.sign(claims, 900));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('rejects a token signed with a different key', async () => {
    const service = makeJoseTokenService(options);
    const foreign = await signAccessToken(
      claims,
      { ...options, ...foreignPair },
      900,
    );

    const error = await runFailure(service.verify(foreign));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('rejects an HS256 token, whatever its header claims', async () => {
    // The alg-confusion attack: without a pinned `algorithms` list, jose would
    // honour this header and treat the public key — which anyone can fetch from
    // the JWKS endpoint — as a shared HMAC secret.
    const service = makeJoseTokenService(options);
    const confused = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(options.issuer)
      .setAudience(options.audience)
      .setExpirationTime('900s')
      .sign(new TextEncoder().encode(pair.publicKeyPem));

    const error = await runFailure(service.verify(confused));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('rejects a token for the wrong audience', async () => {
    const service = makeJoseTokenService(options);
    const wrongAudience = await signAccessToken(
      claims,
      { ...options, audience: 'someone-else' },
      900,
    );

    const error = await runFailure(service.verify(wrongAudience));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('rejects a token from the wrong issuer', async () => {
    const service = makeJoseTokenService(options);
    const wrongIssuer = await signAccessToken(
      claims,
      { ...options, issuer: 'someone-else' },
      900,
    );

    const error = await runFailure(service.verify(wrongIssuer));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('rejects an expired token', async () => {
    const service = makeJoseTokenService(options);
    const expired = await signAccessToken(claims, options, -1);

    const error = await runFailure(service.verify(expired));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('surfaces a signing failure as an EntifixConnError', async () => {
    const service = makeJoseTokenService({
      ...options,
      privateKeyPem: 'not-a-pem',
    });

    const error = await runFailure(service.sign(claims, 900));

    expect(error._tag).toBe('EntifixConnError');
  });

  it('imports each key once, however many tokens pass through', async () => {
    const service = makeJoseTokenService(options);

    const [first, second] = await Promise.all([
      run(service.sign(claims, 900)),
      run(service.sign(claims, 900)),
    ]);

    await expect(run(service.verify(first))).resolves.toMatchObject({
      userId: 'user-1',
    });
    await expect(run(service.verify(second))).resolves.toMatchObject({
      userId: 'user-1',
    });
  });
});
