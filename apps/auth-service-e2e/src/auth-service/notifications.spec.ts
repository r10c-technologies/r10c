import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * Account-security notifications, read back through the development outbox.
 *
 * The outbox survives the move to Zitadel because these are the notifications
 * r10c still sends: a device alert is about a *session*, which is the half of
 * authentication that did not leave. Password and recovery mail is Zitadel's
 * now, and lands in Mailpit instead.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const outboxFor = async (email: string) => {
  const res = await service.client.get(
    `/api/dev/outbox?to=${encodeURIComponent(email)}`,
  );
  return res.data.items as Array<{
    kind: string;
    to: string;
    data: Record<string, string>;
  }>;
};

describe('notifications', () => {
  it('announces a sign-in from a device never seen before', async () => {
    const email = `newcomer-${Date.now()}@example.com`;
    await signIn(service, email, {
      deviceId: 'first-device',
      browser: 'Chrome',
      os: 'macOS',
    });

    await signIn(service, email, {
      deviceId: 'second-device',
      browser: 'Safari',
      os: 'iOS',
    });

    const items = await outboxFor(email);
    const newDevice = items.filter(item => item.kind === 'new-device');
    // One per FIRST sighting: the browser that provisioned them, then the
    // second one.
    expect(newDevice).toHaveLength(2);
    expect(newDevice.map(item => item.data['browser']).sort()).toEqual([
      'Chrome',
      'Safari',
    ]);
  });

  it('stays quiet when a familiar device signs in again', async () => {
    const email = `regular-${Date.now()}@example.com`;
    const device = { deviceId: 'same-device', browser: 'Chrome', os: 'macOS' };
    await signIn(service, email, device);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await signIn(service, email, device);
    }

    const items = await outboxFor(email);
    // Announcing every sign-in is how a security alert becomes noise the owner
    // filters out — and then misses the one that mattered.
    expect(items.filter(item => item.kind === 'new-device')).toHaveLength(1);
  });

  it('does not notify when the caller reports no device at all', async () => {
    const email = `headless-${Date.now()}@example.com`;
    await signIn(service, email);

    expect(await outboxFor(email)).toHaveLength(0);
  });

  it('filters the outbox by recipient', async () => {
    const mine = `mine-${Date.now()}@example.com`;
    const theirs = `theirs-${Date.now()}@example.com`;
    for (const email of [mine, theirs]) {
      await signIn(service, email, {
        deviceId: `dev-${email}`,
        browser: 'Chrome',
      });
    }

    const items = await outboxFor(mine);

    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.to === mine)).toBe(true);
  });

  // Being signed out of every device with no explanation looks exactly like an
  // account compromise. The person did not do it, so they have to be told.
  it('tells the owner when an administrator ends all their sessions', async () => {
    const email = `revoked-${Date.now()}@example.com`;
    const session = await signIn(service, email, {
      deviceId: 'revoked-device',
      browser: 'Chrome',
    });

    const admin = await signIn(service, 'ada@example.com');
    const me = await service.client.get('/api/me', {
      headers: { Authorization: `Bearer ${session.data.accessToken}` },
    });

    await service.client.delete(
      `/api/user-identity/${me.data.userId}/sessions`,
      {
        headers: { Authorization: `Bearer ${admin.data.accessToken}` },
      },
    );

    const items = await outboxFor(email);
    expect(items.filter(item => item.kind === 'sessions-revoked')).toHaveLength(
      1,
    );
  });
});
