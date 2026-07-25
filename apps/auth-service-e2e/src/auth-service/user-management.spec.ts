import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * User management, which is where authorization stops being a menu and starts
 * being a decision.
 *
 * Runs in both profiles: every token here is obtained by actually logging in,
 * so nothing depends on knowing the signing secret. The seeded users are one
 * per role (`ada` super-admin, `alan` admin, `grace` user).
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const DEV_PASSWORD = 'password123';

const bearerFor = async (identifier: string): Promise<string> => {
  const res = await service.client.post('/api/auth/login', {
    identifier,
    password: DEV_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`could not sign in as ${identifier} (${res.status})`);
  }
  return `Bearer ${res.data.accessToken}`;
};

const asUser = async (identifier: string) => ({
  headers: { Authorization: await bearerFor(identifier) },
});

/** A fresh email per call, so a rerun against a live store does not collide. */
const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

describe('auth-service user management', () => {
  describe('reading the user collection', () => {
    it('rejects an anonymous request with 401', async () => {
      const res = await service.client.get('/api/user-identity');

      expect(res.status).toBe(401);
    });

    // The distinction the guard exists to make: signed in, and still refused.
    it('refuses a plain user with 403', async () => {
      const email = uniqueEmail('reader');
      await service.client.post('/api/auth/register', {
        password: DEV_PASSWORD,
        identifiers: [{ type: 'email', value: email }],
      });

      const res = await service.client.get(
        '/api/user-identity',
        await asUser(email),
      );

      expect(res.status).toBe(403);
      expect(res.data.permission).toBe('authn:user-identity:read');
    });

    it('lets an admin list users', async () => {
      const res = await service.client.get(
        '/api/user-identity',
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(200);
      expect(res.data.items.length).toBeGreaterThan(0);
      // The role aspect is part of the record, which is what lets the
      // back-office render and edit it without a bespoke endpoint.
      expect(res.data.items[0]).toHaveProperty('role');
    });
  });

  describe('creating users', () => {
    it('lets an admin create another admin', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          displayName: 'New Admin',
          password: DEV_PASSWORD,
          role: 'admin',
          identifiers: [{ type: 'email', value: uniqueEmail('new-admin') }],
        },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(201);
      expect(res.data.roles).toEqual(['admin']);
    });

    // The escalation rule. An admin that can mint a super-admin is an admin
    // that can promote itself by proxy.
    it('refuses an admin creating a super-admin', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          displayName: 'Sneaky',
          password: DEV_PASSWORD,
          role: 'super-admin',
          identifiers: [{ type: 'email', value: uniqueEmail('sneaky') }],
        },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(409);
    });

    it('lets a super-admin create a super-admin', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          displayName: 'Peer',
          password: DEV_PASSWORD,
          role: 'super-admin',
          identifiers: [{ type: 'email', value: uniqueEmail('peer') }],
        },
        await asUser('ada@example.com'),
      );

      expect(res.status).toBe(201);
      expect(res.data.roles).toEqual(['super-admin']);
    });

    it('rejects an unrecognised role with 400', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          password: DEV_PASSWORD,
          role: 'root',
          identifiers: [{ type: 'email', value: uniqueEmail('root') }],
        },
        await asUser('ada@example.com'),
      );

      expect(res.status).toBe(400);
    });

    // Public signup takes no actor, so a crafted role in the body is ignored
    // rather than honoured.
    it('pins a public registration to the lowest tier', async () => {
      const res = await service.client.post('/api/auth/register', {
        displayName: 'Self Signup',
        password: DEV_PASSWORD,
        role: 'super-admin',
        identifiers: [{ type: 'email', value: uniqueEmail('self') }],
      });

      expect(res.status).toBe(201);
      expect(res.data.principal.roles).toEqual(['user']);
    });
  });

  describe('changing a user’s aspects', () => {
    it('lets an admin promote a plain user and revokes their sessions', async () => {
      // The target signs in first, so there is a live session to lose.
      const login = await service.client.post('/api/auth/login', {
        identifier: 'grace@example.com',
        password: DEV_PASSWORD,
      });
      const sessionId = login.data.sessionId;

      const res = await service.client.patch(
        '/api/user-identity/user-3',
        { role: 'admin' },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(200);
      expect(res.data.role).toBe('admin');

      // Revocation is what makes the change immediate: grants are derived from
      // the roles claim, so a surviving token would keep its old access.
      const refreshed = await service.client.post('/api/auth/refresh', {
        sessionId,
      });
      expect(refreshed.status).toBe(401);
    });

    it('refuses an admin touching a super-admin', async () => {
      const res = await service.client.patch(
        '/api/user-identity/user-1',
        { role: 'user' },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(409);
    });

    it('refuses a plain user outright with 403', async () => {
      // A throwaway account rather than the seeded `grace`, who the promotion
      // test above turns into an admin — a spec that only passes when its
      // neighbours have not run yet is worse than no spec.
      const email = uniqueEmail('plain');
      await service.client.post('/api/auth/register', {
        password: DEV_PASSWORD,
        identifiers: [{ type: 'email', value: email }],
      });

      const res = await service.client.patch(
        '/api/user-identity/user-2',
        { role: 'user' },
        await asUser(email),
      );

      expect(res.status).toBe(403);
    });

    it('refuses self-demotion', async () => {
      const res = await service.client.patch(
        '/api/user-identity/user-1',
        { role: 'admin' },
        await asUser('ada@example.com'),
      );

      expect(res.status).toBe(409);
    });
  });
});
