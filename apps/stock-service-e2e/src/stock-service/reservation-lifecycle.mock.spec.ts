import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
} from '../support/tokens';

/**
 * The other half of a hold's life: releasing it, converting it, and doing
 * either twice.
 *
 * `mock`-only for the same reason the sibling file is — these assert exact
 * figures on rows they name, which only holds on a store nothing else has
 * written to. What a live run adds is *contention*, and that is
 * `concurrency.live.spec.ts`.
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

/** Seeded with a lone receipt of 40 and no holds, and named by nothing else. */
const OFFERING = 'product-offering-5';

const crossing = (extra: Record<string, string> = {}) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'x-organization-id': E2E_ORGANIZATION_ID,
  // ⚠️ Deliberately no `Authorization`: these routes take no session, and axios
  // merges per-request headers over the client default.
  Authorization: undefined,
  ...extra,
});

const takeHold = (quantity: number, extra: Record<string, string> = {}) =>
  service.client.post(
    '/api/reservation',
    {
      meta: { type: 'entity', entity: 'reservation' },
      data: { offeringId: OFFERING, quantity },
    },
    { headers: crossing(extra) },
  );

const release = (id: string) =>
  service.client.delete(`/api/reservation/${id}`, { headers: crossing() });

const convert = (id: string) =>
  service.client.post(
    `/api/reservation/${id}/conversion`,
    {},
    { headers: crossing() },
  );

const itemFor = async () => {
  const res: Page = await service.client.get(
    `/api/stock-item?rsql=${encodeURIComponent(`offeringId==${OFFERING}`)}`,
  );
  return res.data.data.items[0];
};

const holdById = async (id: string) => {
  const res = await service.client.get(`/api/reservation/${id}`);
  return res.data.data as Record<string, unknown>;
};

describe('releasing a hold', () => {
  it('gives the claim back without touching onHand', async () => {
    const before = await itemFor();
    const held = await takeHold(3);
    const id = held.data.data.id as string;

    const res = await release(id);

    expect(res.status).toBe(200);
    expect(res.data.outcome).toBe('transitioned');
    const after = await itemFor();
    expect(after['reserved']).toBe(before['reserved']);
    // ⚠️ The goods never left. A release returns a claim; only a conversion
    // consumes stock.
    expect(after['onHand']).toBe(before['onHand']);
  });

  it('marks the hold released rather than deleting it', async () => {
    const held = await takeHold(1);
    const id = held.data.data.id as string;

    await release(id);

    // Kept, not deleted: "why did this buyer lose their basket?" is a support
    // question, and a deleted row cannot answer it.
    expect((await holdById(id))['status']).toBe('released');
  });

  /**
   * ⚠️ The property the saga depends on. `runSaga` dispatches this as a
   * compensation, delivery is at-least-once, and a second delivery erroring
   * would strand a saga that had in fact been fully reversed.
   */
  it('answers 200 and moves nothing when the hold is already gone', async () => {
    const held = await takeHold(2);
    const id = held.data.data.id as string;
    await release(id);
    const after = await itemFor();

    const again = await release(id);

    expect(again.status).toBe(200);
    expect(again.data.outcome).toBe('not-held');
    const unchanged = await itemFor();
    expect(unchanged['reserved']).toBe(after['reserved']);
  });

  it('answers 200 for a reservation id that never existed', async () => {
    const res = await release('no-such-reservation');

    expect(res.status).toBe(200);
    expect(res.data.outcome).toBe('not-held');
  });
});

describe('converting a hold', () => {
  it('consumes the stock: reserved falls and onHand falls with it', async () => {
    const before = await itemFor();
    const held = await takeHold(4);
    const id = held.data.data.id as string;

    const res = await convert(id);

    expect(res.status).toBe(200);
    expect(res.data.outcome).toBe('transitioned');
    const after = await itemFor();
    expect(after['reserved']).toBe(before['reserved']);
    expect(after['onHand']).toBe((before['onHand'] as number) - 4);
  });

  it('writes the sale into the ledger, so the fold is explainable', async () => {
    const held = await takeHold(2);
    const id = held.data.data.id as string;

    await convert(id);

    const movements: Page = await service.client.get(
      `/api/stock-movement?rsql=${encodeURIComponent(`offeringId==${OFFERING}`)}`,
    );
    const sales = movements.data.data.items.filter(
      movement => movement['reason'] === 'sale' && movement['quantity'] === -2,
    );
    // The ledger is the truth and `StockItem` is its materialized fold; a total
    // no movement explains is what makes a fold unreconcilable.
    expect(sales.length).toBeGreaterThan(0);
  });

  it('refuses to convert a hold that was already released', async () => {
    const held = await takeHold(1);
    const id = held.data.data.id as string;
    await release(id);
    const after = await itemFor();

    const res = await convert(id);

    expect(res.data.outcome).toBe('not-held');
    // The important half: nothing moved. A hold that lost its race must not
    // also consume the goods.
    expect((await itemFor())['onHand']).toBe(after['onHand']);
    expect((await holdById(id))['status']).toBe('released');
  });
});

describe('a redelivered command takes one hold, not two', () => {
  /**
   * ⚠️ The finding ADR 0052 recorded, asserted. `POST /api/reservation` mints a
   * fresh id per call, so without the inbox claim a retried saga dispatch takes
   * a **second** hold: stock held by nobody, the ledger correct at every step,
   * and availability quietly wrong.
   */
  it('answers the same hold and moves reserved once', async () => {
    const before = await itemFor();
    const commandId = `saga-e2e-${String(Date.now())}:reserve:0`;

    const first = await takeHold(3, { 'x-command-id': commandId });
    const second = await takeHold(3, { 'x-command-id': commandId });

    expect(first.status).toBe(201);
    // `200`, not `409`: a dispatcher that could not tell a duplicate from an
    // out-of-stock refusal would compensate a hold it believes was never taken.
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);

    const after = await itemFor();
    expect(after['reserved']).toBe((before['reserved'] as number) + 3);
  });

  it('still takes a second hold under a different command id', async () => {
    const before = await itemFor();
    const stamp = String(Date.now());

    await takeHold(1, { 'x-command-id': `saga-${stamp}:reserve:0` });
    await takeHold(1, { 'x-command-id': `saga-${stamp}:reserve:1` });

    // Two lines of one cart are two side effects and each is claimed on its
    // own — one key for the whole step would drop the second line silently.
    expect((await itemFor())['reserved']).toBe(
      (before['reserved'] as number) + 2,
    );
  });

  it('takes a hold per call when no command id is sent at all', async () => {
    const before = await itemFor();

    await takeHold(1);
    await takeHold(1);

    // The header is optional and its absence is not a hole: only a retried
    // dispatch can duplicate, and only a dispatcher has an id to retry under.
    expect((await itemFor())['reserved']).toBe(
      (before['reserved'] as number) + 2,
    );
  });
});
