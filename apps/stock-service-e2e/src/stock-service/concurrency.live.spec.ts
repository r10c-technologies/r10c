import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
} from '../support/tokens';

/**
 * The two properties that only contention can show.
 *
 * ⚠️ **Live-only by construction, not by preference.** The `mock` profile's
 * Mongo is a single-threaded in-memory object graph: its `withTransaction` is
 * atomicity without isolation, and a burst fired at it resolves in the order it
 * was written. Every assertion below would pass there no matter what the
 * service did — including against a plain read-modify-write, which is exactly
 * the implementation these tests exist to rule out. A green race under a fake
 * is not weak evidence; it is none
 * ([ADR 0010](../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * Both were measured by hand on the live lab when the ledger and the crossing
 * were built. A measurement in a commit message is a fact about one afternoon;
 * this is the same fact asserted on every live run.
 *
 * `startMock` is still supplied because `defineServiceE2e` requires it, and it
 * is never called — the filename keeps this file out of a `mock` collection.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'STOCK_SERVICE_URL',
  startMock: startMockService,
  authorization: () => bearerFor(['admin']),
});

type Page = {
  status: number;
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
};

/** Wide enough that a lost update or a split fold is unmistakable in the count. */
const BURST = 20;

const crossingHeaders = {
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'x-organization-id': E2E_ORGANIZATION_ID,
  // The route accepts no session; the suite's default bearer must not ride along.
  Authorization: undefined,
};

/**
 * An offering nothing else in the suite touches, and a fresh one per run.
 *
 * A live store is not reset between runs, so a fixed id would accumulate stock
 * and the arithmetic below would drift. Naming a new one also means the first
 * receipt exercises the upsert branch, which is where the split fold happens.
 */
const freshOffering = (label: string) =>
  `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const itemsFor = async (offeringId: string) => {
  const res: Page = await service.client.get(
    `/api/stock-item?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
  );
  expect(res.status).toBe(200);
  return res.data.data.items;
};

const recordMovement = (offeringId: string, quantity: number, reason: string) =>
  service.client.post('/api/stock-movement', {
    meta: { type: 'entity', entity: 'stock-movement' },
    data: { offeringId, quantity, reason },
  });

const takeHold = (offeringId: string, quantity: number) =>
  service.client.post(
    '/api/reservation',
    {
      meta: { type: 'entity', entity: 'reservation' },
      data: { offeringId, quantity },
    },
    { headers: crossingHeaders },
  );

describe('concurrent receipts', () => {
  it('produce one item row and a total equal to the ledger', async () => {
    const offeringId = freshOffering('receipts');

    const responses = await Promise.all(
      Array.from({ length: BURST }, () =>
        recordMovement(offeringId, 1, 'receipt'),
      ),
    );

    expect(responses.map(response => response.status)).toEqual(
      Array.from({ length: BURST }, () => 201),
    );

    // ⚠️ **One row, not "some rows summing correctly".** `updateOne` with
    // `upsert` is atomic per *document*, so before the unique index existed a
    // burst like this produced nine `StockItem` documents while the ledger
    // stayed perfectly correct — nothing lost and nothing read-modify-written,
    // but the *identity* of the fold broken, and `availability()` then reading
    // one row of nine. The count is the assertion that would have caught it.
    const items = await itemsFor(offeringId);
    expect(items).toHaveLength(1);
    expect(items[0]['onHand']).toBe(BURST);

    const ledger: Page = await service.client.get(
      `/api/stock-movement?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}&pageSize=100`,
    );
    expect(ledger.data.data.total).toBe(BURST);
  });
});

describe('concurrent holds against the last units', () => {
  it('let exactly the available quantity through and refuse the rest', async () => {
    const offeringId = freshOffering('holds');
    const available = 10;
    expect((await recordMovement(offeringId, available, 'receipt')).status).toBe(
      201,
    );

    const responses = await Promise.all(
      Array.from({ length: BURST }, () => takeHold(offeringId, 1)),
    );

    const created = responses.filter(response => response.status === 201);
    const refused = responses.filter(response => response.status === 409);

    // No oversell, and no under-sell either: the conditional write is not a
    // lock, so contention must not cost a hold that was legitimately available.
    expect(created).toHaveLength(available);
    expect(refused).toHaveLength(BURST - available);
    expect(created.length + refused.length).toBe(BURST);

    const items = await itemsFor(offeringId);
    expect(items[0]['reserved']).toBe(available);
    // `onHand` is untouched: a hold is a promise, not a movement.
    expect(items[0]['onHand']).toBe(available);
  });

  it('writes a hold row for every acceptance and none for a refusal', async () => {
    const offeringId = freshOffering('hold-rows');
    const available = 3;
    await recordMovement(offeringId, available, 'receipt');

    await Promise.all(
      Array.from({ length: BURST }, () => takeHold(offeringId, 1)),
    );

    // The counter and the row commit in one transaction, so the two counts
    // agreeing is what says no request left half of itself behind.
    const holds: Page = await service.client.get(
      `/api/reservation?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}&pageSize=100`,
    );
    expect(holds.data.data.total).toBe(available);
  });
});

describe('a receipt racing a hold', () => {
  it('never leaves availability below zero', async () => {
    // The scenario ADR 0010 was written for: a buyer purchases while the vendor
    // receives new stock, both touching the same offering's availability.
    const offeringId = freshOffering('mixed');
    await recordMovement(offeringId, 5, 'receipt');

    await Promise.all(
      Array.from({ length: BURST }, (_, index) =>
        index % 2 === 0
          ? recordMovement(offeringId, 1, 'receipt')
          : takeHold(offeringId, 1),
      ),
    );

    const items = await itemsFor(offeringId);
    expect(items).toHaveLength(1);
    const onHand = items[0]['onHand'] as number;
    const reserved = items[0]['reserved'] as number;

    // Availability may be anything the interleaving allows — what it may never
    // be is negative, which is the whole claim of the conditional write.
    expect(onHand - reserved).toBeGreaterThanOrEqual(0);
    expect(onHand).toBe(5 + BURST / 2);
  });
});
