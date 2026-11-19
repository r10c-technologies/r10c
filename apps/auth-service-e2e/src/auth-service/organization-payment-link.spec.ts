import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * Whether the organization takes payment links: read and set by an admin of
 * the organization the session acts for, and by nobody else (ADR 0081 §1).
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

describe('the organization payment-link acceptance', () => {
  it('is refused to a user without the grant', async () => {
    const res = await service.client.get(
      `/api/organization/${ORG}/payment-link-acceptance`,
      await asUser('grace@example.com'),
    );

    expect(res.status).toBe(403);
  });

  it('answers an admin not found for an organization they do not act for', async () => {
    const res = await service.client.post(
      '/api/organization/somebody-else/set-payment-link-acceptance',
      { accepts: true },
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(404);
  });

  it('is switched on and off by an admin, and read back', async () => {
    const admin = await asUser('alan@example.com');
    for (const accepts of [true, false]) {
      const res = await service.client.post(
        `/api/organization/${ORG}/set-payment-link-acceptance`,
        { accepts },
        admin,
      );
      expect(res.status).toBe(200);

      const read = await service.client.get(
        `/api/organization/${ORG}/payment-link-acceptance`,
        admin,
      );
      expect(read.status).toBe(200);
      expect(read.data).toEqual({ id: ORG, accepts });
    }
  });
});
