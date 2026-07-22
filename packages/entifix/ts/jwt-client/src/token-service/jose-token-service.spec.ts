import type { TokenClaims } from '@r10c/entifix-ts-business';
import { run, runFailure } from '@r10c/entifix-ts-testing-unit';
import { describe, expect, it } from 'vitest';

import {
  type JoseTokenServiceOptions,
  makeJoseTokenService,
  signAccessToken,
  verifyAccessToken,
} from './jose-token-service.js';

const options: JoseTokenServiceOptions = {
  secret: 'a-sufficiently-long-dev-secret-value',
  issuer: 'r10c-auth',
  audience: 'r10c-fleet',
};

const claims: TokenClaims = {
  userId: 'user-1',
  subject: 'sub-1',
  sessionId: 'sess-1',
  roles: ['admin'],
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
    expect(verified['iss']).toBe('r10c-auth');
    expect(verified['aud']).toBe('r10c-fleet');
  });

  it('verifyAccessToken is usable as a bare promise (edge/middleware path)', async () => {
    const token = await signAccessToken(claims, options, 900);

    const verified = await verifyAccessToken(token, options);

    expect(verified.sessionId).toBe('sess-1');
  });

  it('honours an explicit algorithm', async () => {
    const token = await signAccessToken(
      claims,
      { ...options, algorithm: 'HS256' },
      900,
    );

    await expect(verifyAccessToken(token, options)).resolves.toMatchObject({
      userId: 'user-1',
    });
  });

  it('rejects a token signed with a different secret', async () => {
    const service = makeJoseTokenService(options);
    const foreign = await signAccessToken(
      claims,
      { ...options, secret: 'a-totally-different-secret-value-here' },
      900,
    );

    const error = await runFailure(service.verify(foreign));

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

  it('rejects an expired token', async () => {
    const service = makeJoseTokenService(options);
    const expired = await signAccessToken(claims, options, -1);

    const error = await runFailure(service.verify(expired));

    expect(error._tag).toBe('EntifixBuildError');
  });

  it('surfaces a signing failure as an EntifixConnError', async () => {
    const service = makeJoseTokenService({
      ...options,
      algorithm: 'not-a-real-alg',
    });

    const error = await runFailure(service.sign(claims, 900));

    expect(error._tag).toBe('EntifixConnError');
  });
});
