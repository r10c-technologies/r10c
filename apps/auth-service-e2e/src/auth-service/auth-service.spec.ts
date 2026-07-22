import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * The auth-service HTTP surface, in both profiles. `mock` boots the real router
 * in-process over a fake Mongo driver and the stub identity provider; `live`
 * talks to the process on `AUTH_SERVICE_URL`.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

describe('auth-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await service.client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok', service: '@r10c/auth-service' });
  });

  describe('credential flow', () => {
    // A unique identifier per run keeps the live profile idempotent-ish.
    const suffix = Date.now();
    const email = `grace-${suffix}@example.com`;
    const username = `grace-${suffix}`;
    const password = 'correct-horse-battery';

    it('registers an account with multiple identifiers and opens a session', async () => {
      const res = await service.client.post('/api/auth/register', {
        displayName: 'Grace Hopper',
        password,
        identifiers: [
          { type: 'email', value: email },
          { type: 'username', value: username },
        ],
      });

      expect(res.status).toBe(201);
      expect(typeof res.data.accessToken).toBe('string');
      expect(typeof res.data.sessionId).toBe('string');
      expect(res.data.principal.roles).toEqual([]);
    });

    it('logs in with either identifier', async () => {
      const byEmail = await service.client.post('/api/auth/login', {
        identifier: email,
        password,
      });
      const byUsername = await service.client.post('/api/auth/login', {
        identifier: username,
        password,
      });

      expect(byEmail.status).toBe(200);
      expect(byUsername.status).toBe(200);
      // Both identifiers resolve to the same canonical user.
      expect(byUsername.data.principal.userId).toBe(
        byEmail.data.principal.userId,
      );
    });

    it('rejects a wrong password with 401', async () => {
      const res = await service.client.post('/api/auth/login', {
        identifier: email,
        password: 'wrong',
      });

      expect(res.status).toBe(401);
    });

    it('rejects a duplicate identifier with 409', async () => {
      const res = await service.client.post('/api/auth/register', {
        password,
        identifiers: [{ type: 'email', value: email }],
      });

      expect(res.status).toBe(409);
    });

    it('revokes the session on logout so refresh fails', async () => {
      const login = await service.client.post('/api/auth/login', {
        identifier: email,
        password,
      });
      const { sessionId } = login.data;

      const refreshed = await service.client.post('/api/auth/refresh', {
        sessionId,
      });
      expect(refreshed.status).toBe(200);

      await service.client.post('/api/auth/logout', { sessionId });

      const afterLogout = await service.client.post('/api/auth/refresh', {
        sessionId,
      });
      expect(afterLogout.status).toBe(401);
    });
  });
});
