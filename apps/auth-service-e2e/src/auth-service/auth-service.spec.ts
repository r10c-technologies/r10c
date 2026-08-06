import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  markEmailUnverified,
  startMockService,
} from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * The auth-service HTTP surface, in both profiles. `mock` boots the real router
 * in-process over a fake Mongo driver and an in-memory Zitadel; `live` talks to
 * the process on `AUTH_SERVICE_URL`.
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

  describe('sign-in flow', () => {
    // A unique identifier per run keeps the live profile idempotent-ish.
    const suffix = Date.now();
    const email = `grace-${suffix}@example.com`;

    it('starts an authorization with PKCE and a single-use state', async () => {
      const res = await service.client.post('/api/auth/oidc/start', {});

      expect(res.status).toBe(200);
      const url = new URL(res.data.authorizationUrl);
      // The three parameters that make a public client safe. A missing
      // `code_challenge` would silently downgrade the flow to one where a
      // stolen code is enough.
      expect(url.searchParams.get('code_challenge')).toBeTruthy();
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('state')).toBeTruthy();
      expect(url.searchParams.get('nonce')).toBeTruthy();
    });

    it('provisions an unknown subject on first sign-in, at the lowest tier', async () => {
      const res = await signIn(service, email);

      expect(res.status).toBe(200);
      expect(typeof res.data.accessToken).toBe('string');
      expect(typeof res.data.sessionId).toBe('string');
      // Whoever signs themselves up through the hosted UI lands on `user`,
      // because provisioning passes no `actorRoles` and the use-case caps it.
      expect(res.data.principal.roles).toEqual(['user']);
    });

    it('resolves the same subject to the same canonical user on return', async () => {
      const first = await signIn(service, email);
      const second = await signIn(service, email);

      expect(second.status).toBe(200);
      // The `sub` is the key, so a second visit must not mint a second account.
      expect(second.data.principal.userId).toBe(first.data.principal.userId);
    });

    it('signs a seeded user in at the role the seed gave them', async () => {
      const res = await signIn(service, 'ada@example.com');

      expect(res.status).toBe(200);
      expect(res.data.principal.roles).toEqual(['super-admin']);
    });

    // The classic account-linking vector: an address nobody proved they own
    // must never reach an identifier row, because the row is what a device
    // alert is addressed from.
    it('does not project an unverified address onto the account', async () => {
      const claimed = `unverified-${suffix}@example.com`;
      markEmailUnverified(claimed);

      const res = await signIn(service, claimed);
      expect(res.status).toBe(200);

      const admin = await signIn(service, 'ada@example.com');
      const identifiers = await service.client.get(
        '/api/entity-identifier?pageSize=200',
        { headers: { Authorization: `Bearer ${admin.data.accessToken}` } },
      );

      const rows = identifiers.data.items as Array<{
        type: string;
        value: string;
      }>;
      // The subject was recorded — they can sign in — but the address was not.
      expect(rows.some(row => row.value === claimed)).toBe(false);
    });

    it('refuses a callback whose state was never issued', async () => {
      const res = await service.client.post('/api/auth/oidc/callback', {
        code: email,
        state: 'not-a-state',
      });

      expect(res.status).toBe(401);
      expect(res.data.code).toBe('invalidState');
    });

    it('refuses to replay a state that was already spent', async () => {
      const start = await service.client.post('/api/auth/oidc/start', {});
      const state = new URL(start.data.authorizationUrl).searchParams.get(
        'state',
      );

      const first = await service.client.post('/api/auth/oidc/callback', {
        code: email,
        state,
      });
      const replay = await service.client.post('/api/auth/oidc/callback', {
        code: email,
        state,
      });

      expect(first.status).toBe(200);
      // Single-use is the whole point: a callback URL that leaks from a browser
      // history or a proxy log is already spent by the time anyone finds it.
      expect(replay.status).toBe(401);
    });

    it('400s on a callback with no code', async () => {
      const res = await service.client.post('/api/auth/oidc/callback', {
        state: 'whatever',
      });

      expect(res.status).toBe(400);
      expect(res.data.code).toBe('invalidRequest');
    });

    it('revokes the session on logout and says where to end the provider one', async () => {
      const session = await signIn(service, email);
      const { sessionId } = session.data;

      const refreshed = await service.client.post('/api/auth/refresh', {
        sessionId,
      });
      expect(refreshed.status).toBe(200);

      const loggedOut = await service.client.post('/api/auth/logout', {
        sessionId,
      });
      // Without this the user is "signed out" locally and one click from being
      // signed straight back in, with no prompt.
      expect(loggedOut.data.endSessionUrl).toContain('id_token_hint');

      const afterLogout = await service.client.post('/api/auth/refresh', {
        sessionId,
      });
      expect(afterLogout.status).toBe(401);
    });
  });

  describe('refresh', () => {
    const email = `ada-${Date.now()}-refresh@example.com`;

    const openSession = async () => (await signIn(service, email)).data;

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
