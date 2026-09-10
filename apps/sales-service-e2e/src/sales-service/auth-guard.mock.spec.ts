import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, signTokenFor } from '../support/tokens';

/**
 * What the session guards refuse.
 *
 * `mock`-only because it signs deliberately broken tokens and omits headers —
 * assertions about the guard rather than about channels, and the shared
 * journeys would have to authenticate twice to make room for them.
 *
 * Every route here is authenticated **and** organization-scoped. Nothing in
 * this service is readable anonymously: one vendor's counter means nothing to
 * another, and the list is nobody else's business.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SALES_SERVICE_URL',
  startMock: startMockService,
  // No default header: each spec here supplies its own, or deliberately none.
});

const get = (path: string, authorization?: string) =>
  service.client.get(path, {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

describe('an unauthenticated request', () => {
  it.each([['/api/sales-channel'], ['/api/me']])(
    'is refused 401 on %s',
    async path => {
      expect((await get(path)).status).toBe(401);
    },
  );

  it('is refused 401 for a token this service cannot verify', async () => {
    expect((await get('/api/sales-channel', 'Bearer not-a-token')).status).toBe(
      401,
    );
  });

  it('is refused 401 for the metadata document too', async () => {
    // ADR 0026's descriptor is filtered *by the verified principal*, so it needs
    // one — what it does not need is a tenant handle, which is why the route is
    // registered outside `guarded` and answers a signed-in principal who has
    // picked no organization rather than `409`.
    expect((await get('/api/sales-channel/$metadata')).status).toBe(401);
  });
});

describe('an authenticated request', () => {
  it('reaches the channel list with a role that may read it', async () => {
    // Staff are shown which counters exist, so they can be shown the one they
    // are standing at. Authoring them is an `admin` act.
    expect(
      (await get('/api/sales-channel', await bearerFor(['user']))).status,
    ).toBe(200);
  });

  it('is refused 403 for a role that may not author a channel', async () => {
    const res = await service.client.post(
      '/api/sales-channel',
      {
        meta: { type: 'entity', entity: 'sales-channel' },
        data: { name: 'nope', type: 'counter', status: 'active' },
      },
      { headers: { Authorization: await bearerFor(['user']) } },
    );

    expect(res.status).toBe(403);
  });

  it('serves the metadata document to a principal with no organization', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);

    expect(
      (await get('/api/sales-channel/$metadata', `Bearer ${token}`)).status,
    ).toBe(200);
  });

  it('is refused 409 for a principal who has picked no organization', async () => {
    // Not 403: the caller is authenticated and permitted, and what is missing is
    // a tenant scope. There is no database to read without one, and answering
    // 403 would send an operator looking at the grant table.
    const token = await signTokenFor(['admin'], 'user-1', null);

    const res = await get('/api/sales-channel', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('noActiveOrganization');
  });
});
