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
      // Public signup always lands on the lowest tier, whatever the body says.
      expect(res.data.principal.roles).toEqual(['user']);
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

  describe('refresh', () => {
    const suffix = `${Date.now()}-refresh`;
    const email = `ada-${suffix}@example.com`;
    const password = 'correct-horse-battery';

    const openSession = async () => {
      await service.client.post('/api/auth/register', {
        displayName: 'Ada Lovelace',
        password,
        identifiers: [{ type: 'email', value: email }],
      });
      const login = await service.client.post('/api/auth/login', {
        identifier: email,
        password,
      });
      return login.data;
    };

    it('reports the session ceiling separately from the token lifetime', async () => {
      const session = await openSession();

      // These two being different numbers is the fix for the bug that signed
      // everyone out every fifteen minutes: the app sizes cookies to the
      // session, while the token keeps its short life.
      expect(session.expiresIn).toBe(900);
      expect(session.sessionExpiresIn).toBeGreaterThan(session.expiresIn);
    });

    it('mints a usable token from a live session and keeps the ceiling fixed', async () => {
      const session = await openSession();

      const first = await service.client.post('/api/auth/refresh', {
        sessionId: session.sessionId,
      });
      const second = await service.client.post('/api/auth/refresh', {
        sessionId: session.sessionId,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(typeof first.data.accessToken).toBe('string');
      // Sliding renews the window, but the ceiling must not move — otherwise
      // "sliding" quietly becomes "never expires".
      expect(second.data.sessionExpiresAt).toBe(first.data.sessionExpiresAt);
      expect(second.data.sessionExpiresIn).toBeLessThanOrEqual(
        first.data.sessionExpiresIn,
      );
    });

    it('still carries the principal so the app can re-render nav', async () => {
      const session = await openSession();

      const refreshed = await service.client.post('/api/auth/refresh', {
        sessionId: session.sessionId,
      });

      expect(refreshed.data.principal.userId).toBe(session.principal.userId);
      expect(refreshed.data.principal.roles).toEqual(['user']);
    });

    it('401s on an unknown session id', async () => {
      const res = await service.client.post('/api/auth/refresh', {
        sessionId: 'not-a-session',
      });

      expect(res.status).toBe(401);
      expect(res.data.code).toBe('sessionExpired');
    });

    it('400s without a session id', async () => {
      const res = await service.client.post('/api/auth/refresh', {});

      expect(res.status).toBe(400);
      expect(res.data.code).toBe('invalidRequest');
    });
  });
});
