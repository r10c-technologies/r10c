import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  mockLogoutToken,
  providerSessionIdFor,
  providerSubjectFor,
} from '../support/fake-zitadel';
import { startMockService } from '../support/mock-service';
import { signIn as signInWith } from '../support/sign-in';

/**
 * Sign-out from the other direction: the provider ending a session, and r10c's
 * session ending with it.
 *
 * Until this route existed, sign-out was one-way. Ending a session at Zitadel —
 * the console, an operator terminating sessions — left the r10c session alive to
 * its seven-day ceiling, handing out a fresh access token on every refresh. The
 * assertion that matters in every case below is therefore the same one: after
 * the logout token, does `refresh` still mint?
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

/** A never-before-seen address, so each journey owns its account. */
const openAccount = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

const signIn = async (email: string) => {
  const res = await signInWith(service, email, { deviceId: `${email}-device` });
  return res.data as { sessionId: string };
};

/** Form-encoded, as the spec requires and as Zitadel actually posts it. */
const postLogoutToken = (logoutToken: string) =>
  service.client.post(
    '/api/auth/backchannel-logout',
    new URLSearchParams({ logout_token: logoutToken }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
  );

const refresh = (sessionId: string) =>
  service.client.post('/api/auth/refresh', { sessionId });

describe('back-channel logout', () => {
  it('revokes every r10c session the ended provider session opened', async () => {
    // One Zitadel session can open several of ours — the same browser reaching
    // two apps. Signing out at the provider has to end all of them, or "sign me
    // out everywhere" leaves the other one live.
    const email = openAccount('backchannel');
    const first = await signIn(email);
    const second = await signIn(email);

    const res = await postLogoutToken(
      mockLogoutToken({
        providerSessionId: providerSessionIdFor(email),
        subject: providerSubjectFor(email),
      }),
    );

    expect(res.status).toBe(200);
    expect((await refresh(first.sessionId)).status).toBe(401);
    expect((await refresh(second.sessionId)).status).toBe(401);
  });

  it('tells caches not to keep the answer', async () => {
    const email = openAccount('nostore');
    await signIn(email);

    const res = await postLogoutToken(
      mockLogoutToken({ providerSessionId: providerSessionIdFor(email) }),
    );

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('falls back to the subject when the token names no session', async () => {
    // Some providers send only `sub`, and it is also what a lost index write
    // looks like from here — so the fallback is what keeps that failure from
    // becoming a session that quietly survives.
    const email = openAccount('subonly');
    const session = await signIn(email);

    const res = await postLogoutToken(
      mockLogoutToken({ subject: providerSubjectFor(email) }),
    );

    expect(res.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(401);
  });

  it('is idempotent, because a provider retries', async () => {
    const email = openAccount('retry');
    const session = await signIn(email);
    const token = mockLogoutToken({
      providerSessionId: providerSessionIdFor(email),
    });

    await postLogoutToken(token);
    const replay = await postLogoutToken(token);

    expect(replay.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(401);
  });

  it('answers ok for a session it does not know, and touches nothing', async () => {
    // A 404 here would make the endpoint an oracle for whether a session exists,
    // and the provider has nothing useful to do with the answer either way.
    const email = openAccount('bystander');
    const session = await signIn(email);

    const res = await postLogoutToken(
      mockLogoutToken({ providerSessionId: 'sid-nobody-has-this' }),
    );

    expect(res.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses a token that does not verify', async () => {
    // Loud on purpose: a provider misconfigured against this endpoint should
    // show up as a failure at Zitadel, not as silence.
    const res = await postLogoutToken('not-a-logout-token');

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidRequest');
  });

  it('refuses a token naming neither a session nor a subject', async () => {
    const res = await postLogoutToken(mockLogoutToken({}));

    expect(res.status).toBe(400);
  });

  it('refuses a request carrying no token at all', async () => {
    const res = await service.client.post(
      '/api/auth/backchannel-logout',
      new URLSearchParams({}),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    );

    expect(res.status).toBe(400);
  });
});
