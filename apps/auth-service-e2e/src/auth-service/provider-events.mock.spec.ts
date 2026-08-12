import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import {
  MOCK_ACTION_SIGNING_KEY,
  mockActionPayload,
  mockActionSignature,
  providerSubjectFor,
} from '../support/fake-zitadel';
import { startMockService } from '../support/mock-service';
import { signIn as signInWith } from '../support/sign-in';

/**
 * The hole a logout token never covers: a user deactivated **at the provider**.
 *
 * Measured on Zitadel v4.16.2 — ending a session fires a back-channel logout
 * token, deactivating a user fires nothing, and the r10c session kept refreshing
 * `200` for what would have been seven days. So the assertion here is the same
 * one the back-channel suite makes: after the event, does `refresh` still mint?
 *
 * The signature is the only authentication this route has, and it is not faked:
 * the mock service is wired with the shipped verifier and these payloads are
 * signed the way Zitadel signs them.
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

/**
 * Posted as raw text with the signature Zitadel would have sent. The MAC covers
 * the bytes, so the body must reach the service exactly as it was signed —
 * letting axios re-serialise an object is what would break that.
 */
const postEvent = (rawBody: string, signature: string | undefined) =>
  service.client.post('/api/auth/provider-events', rawBody, {
    headers: {
      'content-type': 'application/json',
      ...(signature === undefined ? {} : { 'zitadel-signature': signature }),
    },
    transformRequest: [body => body],
  });

const postSignedEvent = (eventType: string, subject: string) => {
  const rawBody = mockActionPayload(eventType, subject);
  return postEvent(rawBody, mockActionSignature(rawBody));
};

const refresh = (sessionId: string) =>
  service.client.post('/api/auth/refresh', { sessionId });

describe('provider user-lifecycle events', () => {
  it.each(['user.deactivated', 'user.locked', 'user.removed'])(
    'revokes every session the subject holds on %s',
    async eventType => {
      // Every session, not one: the event names a user, and a user with two
      // sessions who is deactivated must keep neither.
      const email = openAccount('lifecycle');
      const first = await signIn(email);
      const second = await signIn(email);

      const res = await postSignedEvent(eventType, providerSubjectFor(email));

      expect(res.status).toBe(200);
      expect((await refresh(first.sessionId)).status).toBe(401);
      expect((await refresh(second.sessionId)).status).toBe(401);
    },
  );

  it('tells caches not to keep the answer', async () => {
    const email = openAccount('nostore');
    await signIn(email);

    const res = await postSignedEvent(
      'user.deactivated',
      providerSubjectFor(email),
    );

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is idempotent, because an event may arrive twice', async () => {
    const email = openAccount('retry');
    const session = await signIn(email);
    const rawBody = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(email),
    );
    const signature = mockActionSignature(rawBody);

    await postEvent(rawBody, signature);
    const replay = await postEvent(rawBody, signature);

    expect(replay.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(401);
  });

  it('answers ok for an event it does not act on', async () => {
    // An execution can be added at the provider without a deploy here, so an
    // unrecognised event type must be a no-op rather than a failure.
    const email = openAccount('bystander');
    const session = await signIn(email);

    const res = await postSignedEvent(
      'user.human.added',
      providerSubjectFor(email),
    );

    expect(res.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('answers ok for a subject it does not know, and touches nothing', async () => {
    // A 404 would make this an oracle for whether an account exists here.
    const email = openAccount('unknown');
    const session = await signIn(email);

    const res = await postSignedEvent('user.deactivated', 'zitadel-nobody');

    expect(res.status).toBe(200);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses an unsigned request, and leaves the session alone', async () => {
    // The whole security of the route: without this, anyone who can reach the
    // port can sign anyone out.
    const email = openAccount('unsigned');
    const session = await signIn(email);
    const rawBody = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(email),
    );

    const res = await postEvent(rawBody, undefined);

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidRequest');
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses a signature made with the wrong key', async () => {
    const email = openAccount('wrongkey');
    const session = await signIn(email);
    const rawBody = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(email),
    );

    const res = await postEvent(
      rawBody,
      mockActionSignature(rawBody, 'not-the-signing-key'),
    );

    expect(res.status).toBe(400);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses a body altered after it was signed', async () => {
    const victim = openAccount('victim');
    const attacker = openAccount('attacker');
    const session = await signIn(victim);
    await signIn(attacker);

    // A payload legitimately signed for one subject, retargeted at another.
    const signedBody = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(attacker),
    );
    const tampered = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(victim),
    );

    const res = await postEvent(tampered, mockActionSignature(signedBody));

    expect(res.status).toBe(400);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses a stale signature', async () => {
    // The timestamp is inside the MAC, so an old capture cannot be re-dated —
    // which is what bounds replay without a jti store.
    const email = openAccount('stale');
    const session = await signIn(email);
    const rawBody = mockActionPayload(
      'user.deactivated',
      providerSubjectFor(email),
    );
    const longAgo = Math.floor(Date.now() / 1000) - 3600;

    const res = await postEvent(
      rawBody,
      mockActionSignature(rawBody, MOCK_ACTION_SIGNING_KEY, longAgo),
    );

    expect(res.status).toBe(400);
    expect((await refresh(session.sessionId)).status).toBe(200);
  });

  it('refuses a signed body that is not a user event', async () => {
    const res = await postEvent('not-json', mockActionSignature('not-json'));

    expect(res.status).toBe(400);
  });
});
