import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * Account-security notifications, read back through the development outbox.
 *
 * The outbox exists precisely so these are testable: the reset link is never
 * returned in a response body, so without a readable record the recovery flow
 * would have no end-to-end coverage at all.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const password = 'correct-horse-battery';

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
    await service.client.post('/api/auth/register', {
      password,
      identifiers: [{ type: 'email', value: email }],
      device: { deviceId: 'first-device', browser: 'Chrome', os: 'macOS' },
    });

    await service.client.post('/api/auth/login', {
      identifier: email,
      password,
      device: { deviceId: 'second-device', browser: 'Safari', os: 'iOS' },
    });

    const items = await outboxFor(email);
    const newDevice = items.filter(item => item.kind === 'new-device');
    // One per FIRST sighting: registration's browser, then the second one.
    expect(newDevice).toHaveLength(2);
    expect(newDevice.map(item => item.data['browser']).sort()).toEqual([
      'Chrome',
      'Safari',
    ]);
  });

  it('stays quiet when a familiar device signs in again', async () => {
    const email = `regular-${Date.now()}@example.com`;
    await service.client.post('/api/auth/register', {
      password,
      identifiers: [{ type: 'email', value: email }],
      device: { deviceId: 'same-device', browser: 'Chrome', os: 'macOS' },
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await service.client.post('/api/auth/login', {
        identifier: email,
        password,
        device: { deviceId: 'same-device', browser: 'Chrome', os: 'macOS' },
      });
    }

    const items = await outboxFor(email);
    // Announcing every sign-in is how a security alert becomes noise the owner
    // filters out — and then misses the one that mattered.
    expect(items.filter(item => item.kind === 'new-device')).toHaveLength(1);
  });

  it('does not notify when the caller reports no device at all', async () => {
    const email = `headless-${Date.now()}@example.com`;
    await service.client.post('/api/auth/register', {
      password,
      identifiers: [{ type: 'email', value: email }],
    });

    expect(await outboxFor(email)).toHaveLength(0);
  });

  it('filters the outbox by recipient', async () => {
    const mine = `mine-${Date.now()}@example.com`;
    const theirs = `theirs-${Date.now()}@example.com`;
    for (const email of [mine, theirs]) {
      await service.client.post('/api/auth/register', {
        password,
        identifiers: [{ type: 'email', value: email }],
        device: { deviceId: `dev-${email}`, browser: 'Chrome' },
      });
    }

    const items = await outboxFor(mine);

    expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => item.to === mine)).toBe(true);
  });
});
