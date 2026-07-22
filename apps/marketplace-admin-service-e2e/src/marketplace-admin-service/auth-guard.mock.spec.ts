import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import { signAccessToken } from '@r10c/entifix-ts-jwt-client';
import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { MOCK_JWT_SECRET, startMockService } from '../support/mock-service';

/**
 * The token-verified backend integration, mock profile only: signing a valid
 * token needs the shared secret, which the test only knows in `mock`. The
 * unauthenticated `401` is asserted here too, alongside the `200`, so the guard
 * is covered end to end against the real router.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: startMockService,
});

const signTestToken = () =>
  signAccessToken(
    {
      userId: 'user-1',
      subject: 'user-1',
      sessionId: 'sess-1',
      roles: ['admin'],
    },
    {
      secret: MOCK_JWT_SECRET,
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    900,
  );

describe('marketplace-admin-service /api/me guard', () => {
  it('rejects a request with no token', async () => {
    const res = await service.client.get('/api/me');

    expect(res.status).toBe(401);
  });

  it('accepts a valid bearer token and returns the principal', async () => {
    const token = await signTestToken();

    const res = await service.client.get('/api/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.userId).toBe('user-1');
    expect(res.data.roles).toEqual(['admin']);
  });

  it('accepts the token from the r10c_at cookie', async () => {
    const token = await signTestToken();

    const res = await service.client.get('/api/me', {
      headers: { Cookie: `r10c_at=${token}` },
    });

    expect(res.status).toBe(200);
    expect(res.data.userId).toBe('user-1');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const foreign = await signAccessToken(
      { userId: 'x', subject: 'x', sessionId: 's', roles: [] },
      {
        secret: 'not-the-shared-secret',
        issuer: AUTH_TOKEN_ISSUER,
        audience: AUTH_TOKEN_AUDIENCE,
      },
      900,
    );

    const res = await service.client.get('/api/me', {
      headers: { Authorization: `Bearer ${foreign}` },
    });

    expect(res.status).toBe(401);
  });
});
