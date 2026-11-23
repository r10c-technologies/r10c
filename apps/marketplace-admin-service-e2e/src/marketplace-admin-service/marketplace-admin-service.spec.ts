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
      `rsql=${encodeURIComponent("name=like='Cable'")}&pageSize=200`,
    );

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Cable'))).toBe(true);
    // `total` must reflect the same filter, or the pager lies about the size.
    expect(pageOf(res).total).toBe(pageOf(res).items.length);
  });

  it('combines two clauses with and', async () => {
    const expression = "name=like='Cinta';name!='Cinta métrica 5 m'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Cinta'))).toBe(true);
    expect(namesOf(res)).not.toContain('Cinta métrica 5 m');
  });

  it('combines two clauses with or', async () => {
    const expression =
      "name=='Martillo de uña 16 oz',name=='Cinta métrica 5 m'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect([...new Set(namesOf(res))].sort()).toEqual([
      'Cinta métrica 5 m',
      'Martillo de uña 16 oz',
    ]);
  });

  it('orders a listing by the sort parameter', async () => {
    const ascending = await list('sort=%2Bname&pageSize=200');
    const descending = await list('sort=-name&pageSize=200');

    expect(namesOf(ascending)).toEqual([...namesOf(ascending)].sort());
    expect(namesOf(descending)).toEqual([...namesOf(ascending)].reverse());
  });

  it('applies filtering, sorting and paging together', async () => {
    const res = await list(
      `rsql=${encodeURIComponent("name=like='Cinta'")}&sort=-name&page=1&pageSize=1`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).items).toHaveLength(1);
    expect(pageOf(res).total).toBeGreaterThan(1);
    // Descending, so page 1 of the two `Cinta` matches — the hardware store's
    // measuring tape and its teflon tape (#676) — is the last alphabetically.
    expect(namesOf(res)[0]).toBe('Cinta métrica 5 m');
  });

  // The metadata allowlist is the trust boundary: without it a client could
  // filter or sort on any field in the collection.
  it.each([
    ['an unknown member', `rsql=${encodeURIComponent('nope==1')}`],
    [
      'a member that is not filterable',
      `rsql=${encodeURIComponent('media==x')}`,
    ],
    ['an unknown sort member', 'sort=nope'],
  ])('rejects %s with a 400', async (_label, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.data).toMatchObject({ code: 'invalidQuery', status: 400 });
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

  // An update names the revision it read, and every write names its key. A
  // seeded product is released and frozen (ADR 0079 §1), so the PUTs below
  // edit a version still in design — created once, and read again before
  // each save because the one save that succeeds moves its revision.
  let draftId: string | undefined;
  const draft = async () => {
    if (draftId === undefined) {
      const created = await post([]);
      draftId = String(created.data.data.id);
    }
    return draftId;
  };
  const put = async (media: unknown) => {
    const id = await draft();
    const current = await service.client.get(
      `/api/product-specification/${id}`,
    );
    return service.client.put(
      `/api/product-specification/${id}`,
      {
        meta: { type: 'entity', entity: 'product-specification' },
        data: {
          id,
          revision: current.data.data.revision,
          ...specification(media),
        },
      },
      { headers: { 'idempotency-key': `"${crypto.randomUUID()}"` } },
    );
  };

  // A create is claimed on its key in the unit of work, so it carries one.
  const post = (media: unknown) =>
    service.client.post(
      '/api/product-specification',
      {
        meta: { type: 'entity', entity: 'product-specification' },
        data: specification(media),
      },
      { headers: { 'idempotency-key': `"${crypto.randomUUID()}"` } },
    );

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

  it('refuses an http URL on the POST create too', async () => {
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
      `/api/product-specification/${await draft()}`,
    );
    expect(read.data.data.media).toEqual(media);
  });
});

/**
 * A released version is never edited (ADR 0079 §1): only its four verbs move
 * it, each a conditional write on the state it leaves.
 */
describe('a product specification version', () => {
  const key = () => ({
    headers: { 'idempotency-key': `"${crypto.randomUUID()}"` },
  });
  const verb = (id: string, name: string) =>
    service.client.post(`/api/product-specification/${id}/${name}`, {}, key());

  it('refuses a PUT on a released version', async () => {
    const current = await service.client.get(
      '/api/product-specification/product-3',
    );
    expect(current.data.data.lifecycleStatus).toBe('active');

    const res = await service.client.put(
      '/api/product-specification/product-3',
      {
        meta: { type: 'entity', entity: 'product-specification' },
        data: {
          id: 'product-3',
          revision: current.data.data.revision,
          name: 'Renamed after release',
        },
      },
      key(),
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('specificationReleased');
  });

  it('opens the next version, releases it, and retires the one it replaces', async () => {
    const next = await verb('product-4', 'revise');
    expect(next.status).toBe(200);
    expect(next.data.data).toMatchObject({
      version: 2,
      lifecycleStatus: 'in-design',
    });
    const id = String(next.data.data.id);

    // A second draft of the same series is refused while this one is open.
    const again = await verb('product-4', 'revise');
    expect(again.status).toBe(409);
    expect(again.data.code).toBe('specificationBeingRevised');

    const released = await verb(id, 'release');
    expect(released.status).toBe(200);
    expect(released.data.data.lifecycleStatus).toBe('active');
    expect(released.data.data.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const previous = await service.client.get(
      '/api/product-specification/product-4',
    );
    expect(previous.data.data.lifecycleStatus).toBe('retired');

    // A released version is kept: orders name it.
    const removed = await service.client.delete(
      '/api/product-specification/product-4',
    );
    expect(removed.status).toBe(409);
    expect(removed.data.code).toBe('specificationReleased');
  });
});
