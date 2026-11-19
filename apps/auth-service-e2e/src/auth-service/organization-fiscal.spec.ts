import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { signIn } from '../support/sign-in';

/**
 * The organization's fiscal identity: read and set by an admin of the
 * organization the session acts for, and by nobody else (ADR 0078 §6). The
 * routes serve at all — the first thing this proves, since a second endpoint
 * group under the entity's own name stopped the service booting.
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
const FISCAL = {
  taxId: '12345679',
  legalName: 'Tienda Demo, S.A.',
  taxRegime: 'general',
  establishmentCode: '1',
};

describe('the organization fiscal identity', () => {
  it('is refused to a user without the grant', async () => {
    const res = await service.client.get(
      `/api/organization/${ORG}/fiscal-identity`,
      await asUser('grace@example.com'),
    );

    expect(res.status).toBe(403);
  });

  it('answers an admin not found for an organization they do not act for', async () => {
    const res = await service.client.get(
      '/api/organization/somebody-else/fiscal-identity',
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(404);
  });

  it('serves the verb an admin sets it through', async () => {
    const res = await service.client.post(
      `/api/organization/${ORG}/set-fiscal-identity`,
      FISCAL,
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(200);

    const read = await service.client.get(
      `/api/organization/${ORG}/fiscal-identity`,
      await asUser('alan@example.com'),
    );
    expect(read.status).toBe(200);
    expect(read.data).toMatchObject({ id: ORG, fiscal: FISCAL });
  });

  it('refuses a NIT that does not validate', async () => {
    const res = await service.client.post(
      `/api/organization/${ORG}/set-fiscal-identity`,
      { ...FISCAL, taxId: '12345678' },
      await asUser('alan@example.com'),
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidFiscalIdentity');
  });
});
