import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';
import { AppLayer, router, SERVICE_NAME } from '@r10c/marketplace-service';
import { serveTestService } from '@r10c/shells-effect-service';

/**
 * marketplace-service is still the foundation shell — `/api/health` and nothing
 * else — so this suite is the contract that the shell boots and answers. Domain
 * routes get asserted here as they arrive.
 *
 * `mock` boots the real router in-process; `live` talks to the process on
 * `MARKETPLACE_SERVICE_URL`. The service needs no infrastructure yet, so the
 * two profiles differ only in who started it.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_SERVICE_URL',
  startMock: () =>
    serveTestService({
      name: SERVICE_NAME,
      // Overridden by `serveTestService`, which binds an ephemeral port.
      port: 0,
      router,
      appLayer: AppLayer,
    }),
});

describe('marketplace-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await service.client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ status: 'ok', service: SERVICE_NAME });
  });

  // The shell answers 404 for anything it does not route, rather than hanging
  // or 500ing — the baseline every domain route is added on top of.
  it('answers 404 for a route it does not serve', async () => {
    const res = await service.client.get('/api/not-a-route');

    expect(res.status).toBe(404);
  });
});
