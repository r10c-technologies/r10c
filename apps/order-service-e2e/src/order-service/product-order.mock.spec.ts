import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
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
