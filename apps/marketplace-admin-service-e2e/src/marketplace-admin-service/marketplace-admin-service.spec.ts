import { defineServiceE2e } from '@entifix/testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor } from '../support/tokens';

/**
 * The marketplace-admin-service HTTP surface, in both profiles.
 *
 * `mock` boots the service's real router in-process over driver fakes; `live`
 * talks to the process on `MARKETPLACE_ADMIN_SERVICE_URL`. The routes, the
 * use-cases, the Mongo repository adapter and the query translation execute
 * either way — only the connections differ — so this one suite is the whole
 * contract.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'MARKETPLACE_ADMIN_SERVICE_URL',
  startMock: startMockService,
  // The catalog routes are guarded now, so these journeys run as an admin.
  // Whether the guard itself works is `auth-guard.mock.spec.ts`'s job.
  authorization: () => bearerFor(['admin']),
});

/**
 * Every collection response is an `EntifixEnvelope`, so the page sits one level
 * down under `data` — reading `res.data.items` finds `undefined`.
 */
const pageOf = (res: {
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
}) => res.data.data;

const namesOf = (res: {
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
}) => pageOf(res).items.map(item => item['name'] as string);

describe('marketplace-admin-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await service.client.get(`/api/health`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      status: 'ok',
      service: '@r10c/marketplace-admin-service',
    });
  });

  it('GET /api/product-specification returns a paginated page', async () => {
    const res = await service.client.get(`/api/product-specification`);

    expect(res.status).toBe(200);
    expect(Array.isArray(pageOf(res).items)).toBe(true);
    expect(typeof pageOf(res).total).toBe('number');
  });

  it('GET /api/config reports its own parameters', async () => {
    const res = await service.client.get(`/api/config`);

    expect(res.status).toBe(200);
    expect(res.data.service).toBe('@r10c/marketplace-admin-service');
  });
});

/**
 * The query protocol end to end: `rsql` is parsed and validated against the
 * entity's metadata, then translated into a Mongo query.
 *
 * Assertions are on the *shape* of the result, never on a record count: the
 * live catalog seed is not idempotent across restarts, so a store that has
 * booted twice holds every brand twice. (In `mock` the store is fresh, so the
 * same assertions simply hold more tightly.)
 */
describe('the RSQL query protocol', () => {
  const list = (query: string) =>
    service.client.get(`/api/product-specification?${query}`);

  it('narrows a listing by a substring match', async () => {
    // One page wide enough to hold every match, so `total` and the page length
    // are comparable.
    const res = await list(
      `rsql=${encodeURIComponent("name=like='Widget'")}&pageSize=200`,
    );

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Widget'))).toBe(true);
    // `total` must reflect the same filter, or the pager lies about the size.
    expect(pageOf(res).total).toBe(pageOf(res).items.length);
  });

  it('combines two clauses with and', async () => {
    const expression = "name=like='Widget';name!='Widget 1'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Widget'))).toBe(true);
    expect(namesOf(res)).not.toContain('Widget 1');
  });

  it('combines two clauses with or', async () => {
    const expression = "name=='Widget 1',name=='Gizmo 1'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect([...new Set(namesOf(res))].sort()).toEqual(['Gizmo 1', 'Widget 1']);
  });

  it('orders a listing by the sort parameter', async () => {
    const ascending = await list('sort=%2Bname&pageSize=200');
    const descending = await list('sort=-name&pageSize=200');

    expect(namesOf(ascending)).toEqual([...namesOf(ascending)].sort());
    expect(namesOf(descending)).toEqual([...namesOf(ascending)].reverse());
  });

  it('applies filtering, sorting and paging together', async () => {
    const res = await list(
      `rsql=${encodeURIComponent("name=like='Widget'")}&sort=-name&page=1&pageSize=1`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).items).toHaveLength(1);
    expect(pageOf(res).total).toBeGreaterThan(1);
    // Descending, so page 1 of the `Widget` matches is the last one alphabetically.
    expect(namesOf(res)[0]).toBe('Widget 6');
  });

  // The metadata allowlist is the trust boundary: without it a client could
  // filter or sort on any field in the collection.
  it.each([
    ['an unknown member', `rsql=${encodeURIComponent('nope==1')}`],
    ['a member that is not filterable', `rsql=${encodeURIComponent('id==1')}`],
    ['an unknown sort member', 'sort=nope'],
  ])('rejects %s with a 400', async (_label, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('invalid query');
  });

  it('rejects a malformed expression with a 400', async () => {
    const res = await list(`rsql=${encodeURIComponent('name==')}`);

    expect(res.status).toBe(400);
  });
});

/**
 * A specification's pictures are references the vendor authored, and the
 * `https` check is the security boundary (ADR 0061). It sits on **both** write
 * paths, so the update cannot be the way round the create.
 */
describe('media on a product specification', () => {
  const specification = (media: unknown) => ({
    name: 'Pictured widget',
    media,
  });

  const put = (media: unknown) =>
    service.client.put('/api/product-specification/product-2', {
      meta: { type: 'entity', entity: 'product-specification' },
      data: { id: 'product-2', ...specification(media) },
    });

  const post = (media: unknown) =>
    service.client.post('/api/product-specification', {
      meta: { type: 'command', entity: 'product-specification' },
      data: {
        transactionId: crypto.randomUUID(),
        type: 'create',
        entity: 'product-specification',
        payload: specification(media),
      },
    });

  it.each([
    [
      'an http URL',
      'mediaNotHttps',
      [{ url: 'http://cdn.example/a.jpg', alt: 'Front' }],
    ],
    [
      'a javascript URL',
      'mediaNotHttps',
      [{ url: 'javascript:alert(1)', alt: 'Front' }],
    ],
    [
      'a blank alt text',
      'mediaAltMissing',
      [{ url: 'https://cdn.example/a.jpg', alt: ' ' }],
    ],
  ])('refuses %s on the PUT with %s', async (_label, code, media) => {
    const res = await put(media);

    expect(res.status).toBe(400);
    expect(res.data.code).toBe(code);
  });

  it('refuses an http URL on the POST command too', async () => {
    const res = await post([{ url: 'http://cdn.example/a.jpg', alt: 'Front' }]);

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('mediaNotHttps');
  });

  it('saves https pictures and reads them back in order', async () => {
    const media = [
      { url: 'https://cdn.example/front.jpg', alt: 'Front' },
      { url: 'https://cdn.example/back.jpg', alt: 'Back' },
    ];

    const saved = await put(media);
    expect(saved.status).toBe(200);

    const read = await service.client.get(
      '/api/product-specification/product-2',
    );
    expect(read.data.data.media).toEqual(media);
  });
});
