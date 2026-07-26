import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * Session and device self-service.
 *
 * The ownership checks are the point of this file. `SessionStore.revoke` will
 * end any id it is handed, which was safe while only logout called it with your
 * own — the moment a route accepts an id from the outside, a session id that
 * leaks into a log or a URL becomes a remote-logout weapon.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const password = 'correct-horse-battery';

/** Register and sign in, optionally reporting a device. */
const openAccount = async (label: string) => {
  const email = `${label}-${Date.now()}@example.com`;
  await service.client.post('/api/auth/register', {
    password,
    identifiers: [{ type: 'email', value: email }],
    device: {
      deviceId: `${label}-device`,
      browser: 'Chrome',
      os: 'macOS',
      type: 'desktop',
      ip: '203.0.113.0',
    },
  });
  return email;
};

const signIn = async (email: string, deviceId: string) => {
  const res = await service.client.post('/api/auth/login', {
    identifier: email,
    password,
    device: { deviceId, browser: 'Firefox', os: 'Linux', type: 'desktop' },
  });
  return res.data as { accessToken: string; sessionId: string };
};

const asUser = (accessToken: string) => ({
  headers: { Authorization: `Bearer ${accessToken}` },
});

describe('session self-service', () => {
  it('lists the caller’s sessions and marks the current one', async () => {
    const email = await openAccount('lister');
    const first = await signIn(email, 'device-a');
    await signIn(email, 'device-b');

    const res = await service.client.get(
      '/api/auth/sessions',
      asUser(first.accessToken),
    );

    expect(res.status).toBe(200);
    expect(res.data.items.length).toBeGreaterThanOrEqual(2);
    const current = res.data.items.filter(
      (item: { current: boolean }) => item.current,
    );
    // Exactly one row is the session you are reading the list from.
    expect(current).toHaveLength(1);
    expect(current[0].sessionId).toBe(first.sessionId);
  });

  it('carries the device label on each session', async () => {
    const email = await openAccount('labelled');
    const session = await signIn(email, 'device-labelled');

    const res = await service.client.get(
      '/api/auth/sessions',
      asUser(session.accessToken),
    );

    const row = res.data.items.find(
      (item: { sessionId: string }) => item.sessionId === session.sessionId,
    );
    expect(row.device).toMatchObject({
      deviceId: 'device-labelled',
      browser: 'Firefox',
      os: 'Linux',
    });
  });

  it('reports the remembered devices', async () => {
    const email = await openAccount('devices');
    const session = await signIn(email, 'device-remembered');

    const res = await service.client.get(
      '/api/auth/devices',
      asUser(session.accessToken),
    );

    expect(res.status).toBe(200);
    // Two distinct browsers: the one that registered, and the one that signed in.
    expect(res.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses to revoke a session belonging to somebody else', async () => {
    const mine = await signIn(await openAccount('victim'), 'device-mine');
    const theirs = await signIn(await openAccount('attacker'), 'device-theirs');

    const res = await service.client.delete(
      `/api/auth/sessions/${mine.sessionId}`,
      asUser(theirs.accessToken),
    );

    // 404 rather than 403: a 403 would confirm the guessed id names a real
    // session belonging to someone.
    expect(res.status).toBe(404);
    // …and it is still alive.
    const still = await service.client.post('/api/auth/refresh', {
      sessionId: mine.sessionId,
    });
    expect(still.status).toBe(200);
  });

  it('revokes one of the caller’s own sessions', async () => {
    const email = await openAccount('self-revoke');
    const keep = await signIn(email, 'device-keep');
    const drop = await signIn(email, 'device-drop');

    const res = await service.client.delete(
      `/api/auth/sessions/${drop.sessionId}`,
      asUser(keep.accessToken),
    );

    expect(res.status).toBe(200);
    expect(res.data.signedOut).toBe(false);
    const dead = await service.client.post('/api/auth/refresh', {
      sessionId: drop.sessionId,
    });
    expect(dead.status).toBe(401);
  });

  it('revoking your current session reports that you signed yourself out', async () => {
    const email = await openAccount('sign-me-out');
    const session = await signIn(email, 'device-current');

    const res = await service.client.delete(
      `/api/auth/sessions/${session.sessionId}`,
      asUser(session.accessToken),
    );

    expect(res.status).toBe(200);
    // The flag is what tells the app to clear cookies and go to sign-in.
    expect(res.data.signedOut).toBe(true);
  });

  it('ends every other session but keeps the caller signed in', async () => {
    const email = await openAccount('revoke-others');
    const mine = await signIn(email, 'device-mine');
    const other = await signIn(email, 'device-other');

    const res = await service.client.post(
      '/api/auth/sessions/revoke-others',
      {},
      asUser(mine.accessToken),
    );

    expect(res.status).toBe(200);
    // The whole reason `revokeAllForUserExcept` exists: a password change must
    // not sign you out of the screen you are standing on.
    const still = await service.client.post('/api/auth/refresh', {
      sessionId: mine.sessionId,
    });
    expect(still.status).toBe(200);
    const dead = await service.client.post('/api/auth/refresh', {
      sessionId: other.sessionId,
    });
    expect(dead.status).toBe(401);
  });

  it('401s an unauthenticated caller', async () => {
    const res = await service.client.get('/api/auth/sessions');

    expect(res.status).toBe(401);
  });
});

describe('administrative session control', () => {
  it('refuses a plain user another account’s sessions', async () => {
    const email = await openAccount('nosy');
    const session = await signIn(email, 'device-nosy');

    const res = await service.client.get(
      '/api/user-identity/user-1/sessions',
      asUser(session.accessToken),
    );

    // Another person's device and IP history is not readable just because you
    // hold a valid session.
    expect(res.status).toBe(403);
  });

  it('lets an administrator read and end a user’s sessions', async () => {
    const admin = await service.client.post('/api/auth/login', {
      identifier: 'ada@example.com',
      password: 'password123',
    });
    const target = await openAccount('target');
    const targetSession = await signIn(target, 'device-target');

    const me = await service.client.get(
      '/api/me',
      asUser(targetSession.accessToken),
    );
    const targetUserId = me.data.userId;

    const listed = await service.client.get(
      `/api/user-identity/${targetUserId}/sessions`,
      asUser(admin.data.accessToken),
    );
    expect(listed.status).toBe(200);
    expect(listed.data.items.length).toBeGreaterThanOrEqual(1);

    const kicked = await service.client.delete(
      `/api/user-identity/${targetUserId}/sessions`,
      asUser(admin.data.accessToken),
    );
    expect(kicked.status).toBe(200);

    const dead = await service.client.post('/api/auth/refresh', {
      sessionId: targetSession.sessionId,
    });
    expect(dead.status).toBe(401);
  });
});
