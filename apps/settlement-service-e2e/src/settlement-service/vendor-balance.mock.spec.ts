import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, operatorBearerFor, signTokenFor } from '../support/tokens';

/**
 * `GET /api/vendor-balance` — what the next run will pay the caller (#562).
 *
 * The seed holds two unsettled lines for the vendor: a sale of 2 500 at a cut
 * of 200, and its mirror. The gross less the cut of each cancels, so the
 * balance is zero over two lines — in GTQ, because there are lines to state a
 * currency for. Nobody but that vendor reads anything.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SETTLEMENT_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

const as = (authorization: string | undefined) => ({
  headers: { Authorization: authorization },
});

describe('the vendor balance', () => {
  it('folds the vendor’s unsettled lines the way the next run will', async () => {
    const res = await service.client.get('/api/vendor-balance');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      amount: 0,
      currency: 'GTQ',
      unsettledEntries: 2,
    });
  });

  it('answers an operator, who acts for no vendor, with nothing', async () => {
    const res = await service.client.get(
      '/api/vendor-balance',
      as(await operatorBearerFor(['admin'])),
    );

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ amount: 0, unsettledEntries: 0 });
  });

  it('answers a vendor session with no organization with nothing', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);
    const res = await service.client.get(
      '/api/vendor-balance',
      as(`Bearer ${token}`),
    );

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ amount: 0, unsettledEntries: 0 });
  });

  it.each([
    ['an anonymous caller', undefined, 401],
    ['a user with no settlement grant', 'user', 403],
  ] as const)('refuses %s with a problem body', async (_who, role, status) => {
    const authorization =
      role === undefined ? undefined : `Bearer ${await signTokenFor([role])}`;
    const res = await service.client.get(
      '/api/vendor-balance',
      as(authorization),
    );

    expect(res.status).toBe(status);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});
