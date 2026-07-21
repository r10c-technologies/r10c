import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';

/**
 * The auth-service HTTP surface, in both profiles. `mock` boots the real router
 * in-process over a fake Mongo driver and the stub identity provider; `live`
 * talks to the process on `AUTH_SERVICE_URL`.
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
});
