import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * The WhatsApp number an organization's buyers may write to: read and set by
 * an admin of the organization the session acts for, and by nobody else
 * (#671).
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'AUTH_SERVICE_URL',
  startMock: startMockService,
});

const asUser = async (email: string) => {
  const res = await signIn(service, email);
  if (res.status !== 200) throw new Error(`could not sign in as ${email}`);
  return { headers: { Authorization: `Bearer ${res.data.accessToken}` } };
};

const ORG = 'e2e-organization';

describe('the organization WhatsApp number', () => {
  it('is refused to a user without the grant', async () => {
    const res = await service.client.get(
      `/api/organization/${ORG}/whatsapp-number`,
      await asUser('grace@example.com'),
    );

    expect(res.status).toBe(403);
  });

  it('answers an admin not found for an organization they do not act for', async () => {
    const res = await service.client.post(
      '/api/organization/somebody-else/set-whatsapp-number',
      { number: '5555-1234' },
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(404);
  });

  it('refuses a number that is not a Guatemalan one', async () => {
    const res = await service.client.post(
      `/api/organization/${ORG}/set-whatsapp-number`,
      { number: '123' },
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(400);
  });

  it('is stated and withdrawn by an admin, and read back as stored', async () => {
    const admin = await asUser('alan@example.com');
    for (const [typed, stored] of [
      ['5555-1234', '+50255551234'],
      ['', ''],
    ] as const) {
      const res = await service.client.post(
        `/api/organization/${ORG}/set-whatsapp-number`,
        { number: typed },
        admin,
      );
      expect(res.status).toBe(200);

      const read = await service.client.get(
        `/api/organization/${ORG}/whatsapp-number`,
        admin,
      );
      expect(read.status).toBe(200);
      expect(read.data).toEqual({ id: ORG, number: stored });
    }
  });
});
