import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * User management, which is where authorization stops being a menu and starts
 * being a decision.
 *
 * Runs in both profiles: every token here is obtained by actually signing in,
 * so nothing depends on knowing the signing secret. The seeded users are one
 * per role (`ada` super-admin, `alan` admin, `grace` user), and each is linked
 * to a provider subject by the same boot seed the service runs.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const bearerFor = async (email: string): Promise<string> => {
  const res = await signIn(service, email);
  if (res.status !== 200) {
    throw new Error(`could not sign in as ${email} (${res.status})`);
  }
  return `Bearer ${res.data.accessToken}`;
};

const asUser = async (email: string) => ({
  headers: { Authorization: await bearerFor(email) },
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
      await signIn(service, email);

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
          role: 'admin',
          identifiers: [{ type: 'email', value: uniqueEmail('new-admin') }],
        },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(201);
      expect(res.data.roles).toEqual(['admin']);
    });

    // The escalation rule. An admin that can mint a super-admin is an admin
    // that can promote itself by proxy. A 403, not a 409: the request is
    // well-formed and conflicts with nothing — the caller simply may not.
    it('refuses an admin creating a super-admin', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          displayName: 'Sneaky',
          role: 'super-admin',
          identifiers: [{ type: 'email', value: uniqueEmail('sneaky') }],
        },
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(403);
      expect(res.data.error).toContain('not allowed to assign that role');
    });

    it('lets a super-admin create a super-admin', async () => {
      const res = await service.client.post(
        '/api/user-identity',
        {
          displayName: 'Peer',
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
          role: 'root',
          identifiers: [{ type: 'email', value: uniqueEmail('root') }],
        },
        await asUser('ada@example.com'),
      );

      expect(res.status).toBe(400);
    });

    // Self sign-up now happens at the provider, so there is no body to craft a
    // role into at all — the callback passes no `actorRoles`, and the use-case
    // caps an absent actor at the default tier.
    it('pins a self-provisioned account to the lowest tier', async () => {
      const res = await signIn(service, uniqueEmail('self'));

      expect(res.status).toBe(200);
      expect(res.data.principal.roles).toEqual(['user']);
    });
  });

  describe('changing a user’s aspects', () => {
    it('lets an admin promote a plain user and revokes their sessions', async () => {
      // The target signs in first, so there is a live session to lose.
      const login = await signIn(service, 'grace@example.com');
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

      expect(res.status).toBe(403);
    });

    it('refuses a plain user outright with 403', async () => {
      // A throwaway account rather than the seeded `grace`, who the promotion
      // test above turns into an admin — a spec that only passes when its
      // neighbours have not run yet is worse than no spec.
      const email = uniqueEmail('plain');
      await signIn(service, email);

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

      expect(res.status).toBe(403);
    });
  });
  /**
   * The served affordance document (ADR 0026). What makes these worth running in
   * both profiles is that the filtering is a **security** boundary, not
   * presentation: the document names domains, entity keys and verbs, so it is a
   * map of the model.
   */
  describe('the $metadata document', () => {
    it('rejects an anonymous request with 401', async () => {
      const res = await service.client.get('/api/user-identity/$metadata');

      expect(res.status).toBe(401);
    });

    it('answers 404 — not 403 — to a caller who may not read the entity', async () => {
      const email = uniqueEmail('metadata-plain');
      await signIn(service, email);

      const res = await service.client.get(
        '/api/user-identity/$metadata',
        await asUser(email),
      );

      // Deliberately indistinguishable from an entity this service does not
      // host, so the endpoint cannot be walked to enumerate the model. A 403
      // here would confirm the entity exists to somebody who may not see it.
      expect(res.status).toBe(404);
      expect(res.data.code).toBe('notFound');
    });

    it('serves an admin the actions and verbs they actually hold', async () => {
      const res = await service.client.get(
        '/api/user-identity/$metadata',
        await asUser('alan@example.com'),
      );

      expect(res.status).toBe(200);
      expect(res.data.meta).toMatchObject({
        type: 'entityMetadata',
        entity: 'user-identity',
      });
      // `admin` holds read and write on this entity, and not delete.
      expect(res.data.data.actions).toEqual(['read', 'write']);
      expect(
        res.data.data.useCases.map((d: { key: string }) => d.key).sort(),
      ).toEqual(['revoke-sessions', 'update-aspects']);
    });

    it('serves the whole triple on a wildcard grant', async () => {
      const res = await service.client.get(
        '/api/user-identity/$metadata',
        await asUser('ada@example.com'),
      );

      expect(res.status).toBe(200);
      expect(res.data.data.actions).toEqual(['read', 'write', 'delete']);
    });

    it('marks the response private and revalidates on its ETag', async () => {
      const auth = await asUser('alan@example.com');
      const first = await service.client.get(
        '/api/user-identity/$metadata',
        auth,
      );

      expect(first.headers['cache-control']).toContain('private');
      expect(first.headers['vary']).toBe('Cookie, Authorization');

      const etag = first.headers['etag'];
      const second = await service.client.get('/api/user-identity/$metadata', {
        headers: { ...auth.headers, 'If-None-Match': etag },
        // The client treats a 304 as a success rather than throwing on it.
        validateStatus: () => true,
      });

      expect(second.status).toBe(304);
    });

    it('is reached at its literal path, not swallowed by the by-id route', async () => {
      // The regression test for the routing trap: `find-my-way-ts` prefers a
      // static segment, but only because the path is a literal. A parametric
      // `/api/:entity/$metadata` would lose to `/api/user-identity/:id`, which
      // would look up a user with the id "$metadata" and answer its own 404 —
      // an endpoint that appears mounted and never runs.
      const res = await service.client.get(
        '/api/user-identity/$metadata',
        await asUser('alan@example.com'),
      );

      expect(res.data.meta?.type).toBe('entityMetadata');
    });
  });
});
