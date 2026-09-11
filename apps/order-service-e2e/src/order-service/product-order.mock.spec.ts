import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
  E2E_PARTY_ID,
  signTokenFor,
} from '../support/tokens';

/**
 * Writing and reading an order.
 *
 * The two halves take **different credentials on purpose**, and every assertion
 * about that is here rather than in a comment: writing an order is a saga step
 * behind a crossing token, reading one is an ordinary authenticated read. What
 * ADR 0023 forbids is a single *route* taking either.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'ORDER_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

type Page = {
  status: number;
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
};

const crossing = (extra: Record<string, string> = {}) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  // ⚠️ Deliberately no `Authorization`: these routes take no session, and axios
  // merges per-request headers over the client default.
  Authorization: undefined,
  ...extra,
});

const line = (offeringId: string, quantity = 1) => ({
  offeringId,
  vendorId: E2E_ORGANIZATION_ID,
  quantity,
  amount: 1999,
  currency: 'GTQ',
  reservationId: `res-${offeringId}`,
});

const place = (
  items: ReadonlyArray<ReturnType<typeof line>>,
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/product-order',
    {
      meta: { type: 'entity', entity: 'product-order' },
      data: { buyerId: 'party-user-2', items },
    },
    { headers: crossing(extra) },
  );

const remove = (id: string) =>
  service.client.delete(`/api/product-order/${id}`, { headers: crossing() });

describe('placing an order', () => {
  it('writes it with its lines and answers 201', async () => {
    const res = await place([line('offering-a'), line('offering-b', 2)]);

    expect(res.status).toBe(201);
    expect(res.data.data.items).toHaveLength(2);
    expect(typeof res.data.data.id).toBe('string');
  });

  it('owns the id, the status and placedAt whatever the body says', async () => {
    const res = await place([line('offering-c')]);

    // A body arriving as `paid` would claim money nobody took.
    expect(res.data.data.status).toBe('pending');
    expect(typeof res.data.data.placedAt).toBe('string');
  });

  /**
   * The price was captured at checkout from what the buyer was shown. Re-reading
   * it would charge them today's price for yesterday's basket.
   */
  it('keeps the amount the caller captured, rather than re-deriving it', async () => {
    const res = await place([{ ...line('offering-d'), amount: 500 }]);

    expect(res.data.data.items[0].amount).toBe(500);
  });

  it('carries the vendor on the line, so one order can span several', async () => {
    const res = await place([
      { ...line('offering-e'), vendorId: 'vendor-a' },
      { ...line('offering-f'), vendorId: 'vendor-b' },
    ]);

    expect(
      res.data.data.items.map((item: { vendorId: string }) => item.vendorId),
    ).toEqual(['vendor-a', 'vendor-b']);
  });

  it('refuses an order with no lines', async () => {
    const res = await place([]);

    // Not a sale: it would settle to nothing, show an empty receipt and hold no
    // stock.
    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });
});

describe('the write takes a crossing token and no session', () => {
  it('refuses a session, even an admin one', async () => {
    const res = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: { items: [line('offering-g')] },
      },
      { headers: { Authorization: await bearerFor(['admin']) } },
    );

    // ⚠️ The assertion that matters: `super-admin` holds `*:*:*`, which matches
    // every crossing permission — so a route accepting both credentials would
    // be reachable from an operator's browser tab, and the weaker one would be
    // the security level.
    expect(res.status).toBe(401);
  });

  it('refuses a wrong crossing token', async () => {
    const res = await place([line('offering-h')], {
      'x-crossing-token': 'not-the-token',
    });

    expect(res.status).toBe(401);
  });

  it('needs no organization header, because the store has no tenancy', async () => {
    const res = await place([line('offering-i')]);

    // The inverse of stock-service's crossing, which requires one: there is no
    // tenant handle to choose here, and demanding a header nothing consumes is
    // theatre a caller learns to satisfy with any value.
    expect(res.status).toBe(201);
  });
});

describe('reading orders takes a session and no token', () => {
  it('lists them for a principal holding the read grant', async () => {
    await place([line('offering-j')]);

    const res: Page = await service.client.get('/api/product-order');

    expect(res.data.data.total).toBeGreaterThan(0);
  });

  it('refuses an anonymous read', async () => {
    const res: Page = await service.client.get('/api/product-order', {
      headers: { Authorization: undefined },
    });

    expect(res.status).toBe(401);
  });

  it('serves $metadata from a literal path, not through :id', async () => {
    const res = await service.client.get('/api/product-order/$metadata');

    // Registered as `/api/:entity/$metadata` it would be shadowed by the by-id
    // route and answer that route's 404, which reads as "this entity has no
    // metadata" (ADR 0026).
    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('product-order');
  });
});

/**
 * Who sees which orders.
 *
 * ⚠️ **This store is platform plane**, so there is no tenant handle doing the
 * isolation the way stock-service's is: one database holds every buyer's
 * receipts, and the predicate the route builds from the verified principal is
 * the whole boundary.
 *
 * The three shapes are minted here rather than taken from `bearerFor`, which
 * hardcodes the vendor defaults — a scoping assertion that cannot vary the
 * principal is asserting nothing.
 */
describe('a read is scoped to the caller, from the principal', () => {
  const asPrincipal = async (
    organizationId: string | null,
    partyRole: 'customer' | 'vendor' | 'operator',
    partyId: string | null,
  ) => ({
    Authorization: `Bearer ${await signTokenFor(
      ['admin'],
      'user-1',
      organizationId,
      partyRole,
      partyId,
    )}`,
  });

  const list = async (headers: Record<string, string>): Promise<Page> =>
    service.client.get('/api/product-order', { headers });

  const ids = (page: Page) => page.data.data.items.map(item => item['id']);

  it('shows a vendor the orders that owe them a line, and no others', async () => {
    const mine = await place([
      { ...line('offering-scope-a'), vendorId: 'vendor-scoped' },
    ]);
    const theirs = await place([
      { ...line('offering-scope-b'), vendorId: 'vendor-other' },
    ]);

    const page = await list(
      await asPrincipal('vendor-scoped', 'vendor', E2E_PARTY_ID),
    );

    expect(ids(page)).toContain(mine.data.data.id);
    expect(ids(page)).not.toContain(theirs.data.data.id);
  });

  it('shows a buyer only what they placed', async () => {
    const mine = await place([line('offering-scope-c')]);
    const theirs = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          buyerId: 'party-somebody-else',
          items: [line('offering-scope-d')],
        },
      },
      { headers: crossing() },
    );

    const page = await list(await asPrincipal(null, 'customer', E2E_PARTY_ID));

    expect(ids(page)).toContain(mine.data.data.id);
    expect(ids(page)).not.toContain(theirs.data.data.id);
  });

  /**
   * ⚠️ The assertion the whole design exists for. `buyerId` is `filterable`, so
   * this query is well-formed and reaches the repository — it is the conjoined
   * scope, not a rejected query, that keeps it from answering somebody else's
   * receipt.
   */
  it('cannot be widened by a query string naming another buyer', async () => {
    const theirs = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          buyerId: 'party-somebody-else',
          items: [line('offering-scope-e')],
        },
      },
      { headers: crossing() },
    );

    const page: Page = await service.client.get(
      '/api/product-order?rsql=buyerId==party-somebody-else',
      { headers: await asPrincipal(null, 'customer', E2E_PARTY_ID) },
    );

    expect(page.data.data.total).toBe(0);
    expect(ids(page)).not.toContain(theirs.data.data.id);
  });

  it('shows an operator every order', async () => {
    const mine = await place([line('offering-scope-f')]);
    const theirs = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          buyerId: 'party-somebody-else',
          items: [line('offering-scope-g')],
        },
      },
      { headers: crossing() },
    );

    // Every order this suite has placed is in one page here, so the read is
    // widened past the default page size rather than asserting on whichever
    // records happen to land first.
    const page: Page = await service.client.get(
      '/api/product-order?pageSize=200',
      { headers: await asPrincipal(null, 'operator', null) },
    );

    expect(ids(page)).toEqual(
      expect.arrayContaining([mine.data.data.id, theirs.data.data.id]),
    );
  });

  it('shows nothing to a session that can identify no records of its own', async () => {
    await place([line('offering-scope-h')]);

    // A vendor session with no organization: it holds the grant and owns
    // nothing, which is an empty page rather than a 403.
    const page = await list(await asPrincipal(null, 'vendor', null));

    expect(page.status).toBe(200);
    expect(page.data.data.total).toBe(0);
  });

  it('answers 404 for one order the caller may not read', async () => {
    const theirs = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          buyerId: 'party-somebody-else',
          items: [line('offering-scope-i')],
        },
      },
      { headers: crossing() },
    );

    const res = await service.client.get(
      `/api/product-order/${theirs.data.data.id}`,
      { headers: await asPrincipal(null, 'customer', E2E_PARTY_ID) },
    );

    // Not a 403: that would confirm the order exists to somebody who may not
    // see it.
    expect(res.status).toBe(404);
    expect(res.data.code).toBe('notFound');
  });

  it('serves the caller their own order by id', async () => {
    const mine = await place([line('offering-scope-j')]);

    const res = await service.client.get(
      `/api/product-order/${mine.data.data.id}`,
      { headers: await asPrincipal(null, 'customer', E2E_PARTY_ID) },
    );

    expect(res.status).toBe(200);
    expect(res.data.data.id).toBe(mine.data.data.id);
  });
});

describe('a redelivered command writes one order, not two', () => {
  /**
   * ⚠️ The saga dispatches this step at-least-once. Without the claim a
   * redelivery writes a **second** receipt against holds that were only ever
   * taken once, and the buyer sees two orders for one checkout.
   */
  it('answers the same order and does not write a second', async () => {
    const before: Page = await service.client.get('/api/product-order');
    const commandId = `saga-${String(Date.now())}:write-order`;

    const first = await place([line('offering-k')], {
      'x-command-id': commandId,
    });
    const second = await place([line('offering-k')], {
      'x-command-id': commandId,
    });

    expect(first.status).toBe(201);
    // `200`, not `409`: a coordinator that could not tell a duplicate from a
    // refusal would compensate an order it believes was never written, and
    // release holds that are still backing it.
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);

    const after: Page = await service.client.get('/api/product-order');
    expect(after.data.data.total).toBe(before.data.data.total + 1);
  });
});

describe('deleting an order is a compensation', () => {
  it('removes it and reports what it did', async () => {
    const placed = await place([line('offering-l')]);
    const id = placed.data.data.id as string;

    const res = await remove(id);

    expect(res.status).toBe(200);
    expect(res.data.outcome).toBe('deleted');
  });

  /**
   * ⚠️ Deleted rather than marked `cancelled`. A compensation reverses a step
   * that should not have happened; a cancellation is a business event with its
   * own record and its own money consequences. Leaving a `cancelled` row would
   * put an order in a buyer's history they never completed.
   */
  it('leaves nothing behind to read', async () => {
    const placed = await place([line('offering-m')]);
    const id = placed.data.data.id as string;

    await remove(id);

    expect((await service.client.get(`/api/product-order/${id}`)).status).toBe(
      404,
    );
  });

  it('answers 200 on a second delivery, so a retry does not strand the saga', async () => {
    const placed = await place([line('offering-n')]);
    const id = placed.data.data.id as string;
    await remove(id);

    const again = await remove(id);

    expect(again.status).toBe(200);
    expect(again.data.outcome).toBe('not-found');
  });

  it('refuses a session on the delete, exactly as on the write', async () => {
    const placed = await place([line('offering-o')]);
    const id = placed.data.data.id as string;

    const res = await service.client.delete(`/api/product-order/${id}`, {
      headers: { Authorization: await bearerFor(['admin']) },
    });

    expect(res.status).toBe(401);
  });
});

/**
 * The buyer's cancel capability, as much of it as this bundle builds: the digest
 * arrives with the order and the window is stamped from it. The route that
 * spends the capability is the cancellation saga's, and it is not served yet.
 */
const placeWithDigest = (
  data: Record<string, unknown>,
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/product-order',
    {
      meta: { type: 'entity', entity: 'product-order' },
      data: { buyerId: 'party-user-2', items: [line('offering-cap')], ...data },
    },
    { headers: crossing(extra) },
  );

describe('the cancel capability an order carries', () => {
  it('stamps a window when the order brought a digest', async () => {
    const res = await placeWithDigest({ cancelDigest: 'a'.repeat(64) });

    expect(res.status).toBe(201);
    expect(res.data.data.cancelDigest).toBe('a'.repeat(64));

    const placedAt = Date.parse(String(res.data.data.placedAt));
    const endsAt = Date.parse(String(res.data.data.cancelWindowEndsAt));
    // 30 minutes, the same number the storefront's receipt cookie lives for.
    expect(endsAt - placedAt).toBe(1800 * 1000);
  });

  /**
   * ⚠️ A counter sale brings no digest, because at a till there is no browser to
   * hold the nonce. An order with a window and nothing to open it would be a
   * Cancel button nobody can press.
   */
  it('stamps no window when the order brought none', async () => {
    const res = await placeWithDigest({});

    expect(res.status).toBe(201);
    expect(res.data.data.cancelDigest).toBeUndefined();
    expect(res.data.data.cancelWindowEndsAt).toBeUndefined();
  });

  /**
   * ⚠️ Server-owned. A body that could choose its own expiry could choose one
   * that never arrives, which is a hold on a refund that never lapses.
   */
  it('owns the window whatever the body says', async () => {
    const res = await placeWithDigest({
      cancelDigest: 'b'.repeat(64),
      cancelWindowEndsAt: '2099-01-01T00:00:00.000Z',
    });

    expect(Date.parse(String(res.data.data.cancelWindowEndsAt))).toBeLessThan(
      Date.parse('2099-01-01T00:00:00.000Z'),
    );
  });
});
