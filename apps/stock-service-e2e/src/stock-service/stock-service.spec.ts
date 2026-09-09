import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor } from '../support/tokens';

/**
 * The stock-service HTTP surface, in both profiles.
 *
 * `mock` boots the service's real router in-process over a driver fake; `live`
 * talks to the process on `STOCK_SERVICE_URL`. The routes, the movement's
 * transaction, the `$inc` fold and the query translation execute either way —
 * only the connection differs — so this one suite is the whole read-and-write
 * contract, minus the concurrency property, which no single-threaded fake can
 * answer (`concurrency.live.spec.ts`).
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'STOCK_SERVICE_URL',
  startMock: startMockService,
  // Every route here is guarded. Whether the guards themselves work is
  // `auth-guard.mock.spec.ts`'s job.
  authorization: () => bearerFor(['admin']),
});

type Page = {
  status: number;
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
};
type Single = { status: number; data: { data: Record<string, unknown> } };

/**
 * Every collection response is an `EntifixEnvelope`, so the page sits one level
 * down under `data` — reading `res.data.items` finds `undefined`.
 */
const pageOf = (res: Page) => res.data.data;

/**
 * The seeded rows these journeys **name**, from
 * `apps/stock-service/src/stock-temp-data.ts`.
 *
 * ⚠️ Naming them is the point of this suite. An assertion that some item exists
 * passes against a store the seed never touched, which is the exact defect
 * #223 was written for: a walk that finds nothing passing for the wrong reason.
 * These four are the four shapes the seed cycles, so between them every read
 * path has a row it was asked about by name.
 */
const SEEDED = {
  /** One receipt, nothing else: the ordinary case. */
  simple: { offeringId: 'product-offering-1', onHand: 10, movements: 1 },
  /** A receipt and a sale — a fold of two, one of them negative. */
  sold: { offeringId: 'product-offering-2', onHand: 13, movements: 2 },
  /** Receipt, sale and a negative `adjustment` — a fold of three. */
  adjusted: { offeringId: 'product-offering-3', onHand: 17, movements: 3 },
  /** A receipt cancelled by an equal sale: zero on hand, *through the ledger*. */
  soldOut: { offeringId: 'product-offering-4', onHand: 0, movements: 2 },
  /**
   * Seeded with no `StockItem` row at all. Not the same thing as zero on hand,
   * and the branch `take-reservation` meets first — it does not upsert, so a
   * missing item is a `409` from a path nothing else reaches.
   */
  unstocked: { offeringId: 'product-offering-41' },
} as const;

const byOffering = (offeringId: string) =>
  `rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`;

const itemFor = async (offeringId: string) => {
  const res: Page = await service.client.get(
    `/api/stock-item?${byOffering(offeringId)}`,
  );
  expect(res.status).toBe(200);
  return pageOf(res).items[0];
};

const recordMovement = (
  offeringId: string,
  quantity: number,
  reason: string,
) =>
  service.client.post('/api/stock-movement', {
    meta: { type: 'entity', entity: 'stock-movement' },
    data: { offeringId, quantity, reason },
  });

describe('stock-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await service.client.get('/api/health');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      status: 'ok',
      service: '@r10c/stock-service',
    });
  });

  it('GET /api/config reports its own parameters', async () => {
    const res = await service.client.get('/api/config');

    expect(res.status).toBe(200);
    expect(res.data.service).toBe('@r10c/stock-service');
  });

  it('GET /api/me returns the principal the token names', async () => {
    const res = await service.client.get('/api/me');

    expect(res.status).toBe(200);
    expect(res.data.roles).toContain('admin');
  });
});

describe('the seeded store', () => {
  it.each([
    ['a single receipt', SEEDED.simple],
    ['a receipt and a sale', SEEDED.sold],
    ['a receipt, a sale and an adjustment', SEEDED.adjusted],
    ['a receipt cancelled by an equal sale', SEEDED.soldOut],
  ])('folds %s into the total the ledger implies', async (_shape, seeded) => {
    const item = await itemFor(seeded.offeringId);

    expect(item).toBeDefined();
    expect(item['onHand']).toBe(seeded.onHand);
    // Nothing seeds a hold: one is taken by the crossing, and a seeded hold
    // would be a promise to a checkout that never happened.
    expect(item['reserved']).toBe(0);
  });

  it('leaves an unstocked offering with no row at all', async () => {
    const res: Page = await service.client.get(
      `/api/stock-item?${byOffering(SEEDED.unstocked.offeringId)}`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).total).toBe(0);
  });

  it('has a movement behind every total', async () => {
    // The fold is only reconcilable if the ledger explains it — a total seeded
    // with no movements is the one state reconciliation can never reproduce.
    const res: Page = await service.client.get(
      `/api/stock-movement?${byOffering(SEEDED.adjusted.offeringId)}&pageSize=50`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).total).toBe(SEEDED.adjusted.movements);
    const sum = pageOf(res).items.reduce(
      (total, movement) => total + (movement['quantity'] as number),
      0,
    );
    expect(sum).toBe(SEEDED.adjusted.onHand);
  });

  it('serves one item by id', async () => {
    const item = await itemFor(SEEDED.simple.offeringId);

    const res: Single = await service.client.get(
      `/api/stock-item/${item['id']}`,
    );

    expect(res.status).toBe(200);
    expect(res.data.data['offeringId']).toBe(SEEDED.simple.offeringId);
  });

  it('answers 404 for an id that is not there', async () => {
    const res = await service.client.get('/api/stock-item/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.data.code).toBe('notFound');
  });

  it('serves entity metadata without a tenant handle', async () => {
    const res = await service.client.get('/api/stock-item/$metadata');

    expect(res.status).toBe(200);
    expect(res.data.meta.entity).toBe('stock-item');
  });
});

/**
 * ⚠️ **Every journey that writes uses a fresh offering, never a seeded one.**
 *
 * The seeded assertions above are exact — #223's whole point is that a live run
 * names the rows it checks rather than asserting something exists — and exact
 * totals only survive if nothing in the suite moves them. Recording a receipt
 * against `product-offering-1` would leave the store one run ahead of the
 * numbers, so the *second* live pass on a lab would fail and say nothing about
 * the code. A fresh id per test also means the first receipt exercises the
 * upsert branch, which is the one that creates the row.
 *
 * The refusal journeys are the exception and need no help: they are asserted
 * *not* to write.
 */
const freshOffering = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe('recording a movement', () => {
  it('creates the item on the first movement, then moves it by exactly the quantity', async () => {
    const offeringId = freshOffering('receipt');

    const first = await recordMovement(offeringId, 3, 'receipt');

    expect(first.status).toBe(201);
    expect(first.data.data.quantity).toBe(3);
    // Server-owned: the client does not choose it, and a body that named one
    // would have it overwritten.
    expect(typeof first.data.data.id).toBe('string');

    // The upsert branch: a vendor's first receipt makes the row rather than
    // requiring one to exist.
    const created = await itemFor(offeringId);
    expect(created['onHand']).toBe(3);
    expect(created['reserved']).toBe(0);

    expect((await recordMovement(offeringId, 5, 'receipt')).status).toBe(201);

    const after = await itemFor(offeringId);
    expect(after['onHand']).toBe(8);
    // The fold moved and the hold did not: a receipt is not a promise.
    expect(after['reserved']).toBe(0);
  });

  it('links the movement back to the item it folded into', async () => {
    const res = await recordMovement(freshOffering('links'), 1, 'receipt');

    expect(res.status).toBe(201);
    const links = res.data.meta.links as Array<{ rel: string; href: string }>;
    expect(links.map(link => link.rel)).toEqual(
      expect.arrayContaining(['self', 'list', 'stock-item']),
    );
  });

  it('takes a negative quantity for a sale', async () => {
    const offeringId = freshOffering('sale');
    await recordMovement(offeringId, 10, 'receipt');

    const res = await recordMovement(offeringId, -2, 'sale');

    expect(res.status).toBe(201);
    expect((await itemFor(offeringId))['onHand']).toBe(8);
  });

  it('refuses a sale with a positive quantity', async () => {
    // The direction check, not the sign of a number: a `sale` moves stock out,
    // so a positive one is a caller who meant `receipt` and would otherwise
    // have silently increased the total.
    const res = await recordMovement(SEEDED.simple.offeringId, 4, 'sale');

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('inconsistentMovement');
  });

  it('refuses a zero quantity', async () => {
    const res = await recordMovement(SEEDED.simple.offeringId, 0, 'adjustment');

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('inconsistentMovement');
  });

  it('accepts an adjustment in either direction', async () => {
    // `adjustment` answers `'either'` to `movementDirection`, so this is what
    // proves the consistency check reads the pair rather than the reason alone.
    const offeringId = freshOffering('adjustment');
    await recordMovement(offeringId, 10, 'receipt');

    const up = await recordMovement(offeringId, 2, 'adjustment');
    const down = await recordMovement(offeringId, -2, 'adjustment');

    expect([up.status, down.status]).toEqual([201, 201]);
    expect((await itemFor(offeringId))['onHand']).toBe(10);
  });

  it('refuses a reason the enum does not name', async () => {
    // `reason` is declared `type: 'enum'`, and that metadata drives a control
    // rather than parsing a body — so `shrinkage` deserializes cleanly and
    // would sit in the ledger permanently if the route did not check.
    const res = await recordMovement(SEEDED.simple.offeringId, 1, 'shrinkage');

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('does not move the total when it refuses', async () => {
    const before = await itemFor(SEEDED.simple.offeringId);

    await recordMovement(SEEDED.simple.offeringId, 3, 'sale');

    const after = await itemFor(SEEDED.simple.offeringId);
    expect(after['onHand']).toBe(before['onHand']);
  });
});

describe('the query protocol', () => {
  it('rejects a member the entity does not declare filterable', async () => {
    // `filterable` metadata is simultaneously the server-side allowlist, so
    // this is the same `400` every entity surface produces.
    const res = await service.client.get(
      `/api/stock-item?rsql=${encodeURIComponent("nothing=='x'")}`,
    );

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidQuery');
  });

  it('sorts a ledger by quantity', async () => {
    const res: Page = await service.client.get(
      '/api/stock-movement?sort=quantity&pageSize=10',
    );

    expect(res.status).toBe(200);
    const quantities = pageOf(res).items.map(
      movement => movement['quantity'] as number,
    );
    expect([...quantities].sort((left, right) => left - right)).toEqual(
      quantities,
    );
  });
});
