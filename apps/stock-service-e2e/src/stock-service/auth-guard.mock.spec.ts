import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, signTokenFor } from '../support/tokens';

/**
 * What the session guards refuse.
 *
 * `mock`-only because it signs deliberately broken tokens and omits headers —
 * assertions about the guard rather than about stock, and the shared journeys
 * would have to authenticate twice to make room for them.
 *
 * Every route here is authenticated **and** organization-scoped, which is not
 * the marketplace-service arrangement: nothing in this service is readable
 * anonymously, because a vendor's stock position is exactly what a competitor
 * would want.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'STOCK_SERVICE_URL',
  startMock: startMockService,
  // No default header: each spec here supplies its own, or deliberately none.
});

const get = (path: string, authorization?: string) =>
  service.client.get(path, {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

describe('an unauthenticated request', () => {
  it.each([
    ['/api/stock-item'],
    ['/api/stock-movement'],
    ['/api/reservation'],
    ['/api/me'],
  ])('is refused 401 on %s', async path => {
    expect((await get(path)).status).toBe(401);
  });

  it('is refused 401 for a token this service cannot verify', async () => {
    expect((await get('/api/stock-item', 'Bearer not-a-token')).status).toBe(
      401,
    );
  });
});

describe('an authenticated request', () => {
  it('reaches the ledger with a role that may read it', async () => {
    expect((await get('/api/stock-item', await bearerFor(['user']))).status).toBe(
      200,
    );
  });

  it('is refused 403 for a role that may not write a movement', async () => {
    // `user` may see what is in stock; recording a movement is an `admin` act.
    // The permission is derived from the entity's own `@entity({ domain, key })`,
    // so this is `stock-management:stock-movement:write` without anyone having
    // written that string down.
    const res = await service.client.post(
      '/api/stock-movement',
      {
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId: 'product-offering-1', quantity: 1, reason: 'receipt' },
      },
      { headers: { Authorization: await bearerFor(['user']) } },
    );

    expect(res.status).toBe(403);
  });

  it('is refused when the token carries no organization', async () => {
    // Not "an admin with less data": every route resolves its storage from
    // `activeOrganizationId`, so a caller with no tenant scope has no database
    // to be served from. `null` rather than `undefined` — an `undefined` would
    // trigger the parameter default and quietly keep the organization.
    const token = await signTokenFor(['admin'], 'user-1', null);

    const res = await get('/api/stock-item', `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('noActiveOrganization');
  });
});

describe('what stays open', () => {
  it('refuses metadata to an anonymous caller', async () => {
    // Not open: the descriptor is filtered by the verified principal, so it
    // reports *this caller's* affordances and needs one to report them for
    // (ADR 0026).
    expect((await get('/api/stock-item/$metadata')).status).toBe(401);
  });

  it('serves metadata to a principal who has picked no organization', async () => {
    // The exception every entity makes: `$metadata` describes the *model*
    // rather than tenant data, so it resolves no tenant handle and must not
    // answer `409` where the reads beside it do — a client needs it to render a
    // form before it has anything to put in one.
    const token = await signTokenFor(['admin'], 'user-1', null);

    const res = await get('/api/stock-item/$metadata', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('stock-item');
  });

  it.each([['/api/health'], ['/api/config']])(
    'serves %s without a session',
    async path => {
      expect((await get(path)).status).toBe(200);
    },
  );
});
