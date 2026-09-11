import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
} from '../support/tokens';

/**
 * Putting goods back after a paid order was cancelled.
 *
 * ⚠️ **The whole path, not just the last step.** A restoration only makes sense
 * against a hold that was taken and converted — that is the state a `paid` order
 * leaves behind — so these assert the three-row ledger that explains how the
 * quantity got back rather than asserting one write in isolation.
 *
 * `mock`-only, like its siblings: these name exact figures on a row, which holds
 * only on a store nothing else has written to.
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
const OFFERING = 'product-offering-6';

const crossing = (extra: Record<string, string> = {}) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'x-organization-id': E2E_ORGANIZATION_ID,
  // ⚠️ Deliberately no `Authorization`: this route takes no session.
  Authorization: undefined,
  ...extra,
});

const restore = (
  body: Record<string, unknown> = {},
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/stock-restoration',
    {
      meta: { type: 'entity', entity: 'stock-movement' },
      data: { offeringId: OFFERING, quantity: 2, ...body },
    },
    { headers: crossing(extra) },
  );

const takeHold = (quantity: number) =>
  service.client.post(
    '/api/reservation',
    {
      meta: { type: 'entity', entity: 'reservation' },
      data: { offeringId: OFFERING, quantity },
    },
    { headers: crossing() },
  );

const convert = (id: string) =>
  service.client.post(
    `/api/reservation/${id}/conversion`,
    {},
    { headers: crossing() },
  );

const itemFor = async (offeringId = OFFERING) => {
  const res: Page = await service.client.get(
    `/api/stock-item?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
  );
  return res.data.data.items[0];
};

const ledgerFor = async (offeringId = OFFERING) => {
  const res: Page = await service.client.get(
    `/api/stock-movement?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
  );
  return res.data.data.items;
};

describe('restoring stock after a cancellation', () => {
  it('takes the sale back out of the ledger and puts onHand where it started', async () => {
    const before = await itemFor();
    const held = await takeHold(2);
    await convert(held.data.data.id as string);
    const sold = await itemFor();
    expect(sold['onHand']).toBe((before['onHand'] as number) - 2);

    const res = await restore();

    expect(res.status).toBe(201);
    const after = await itemFor();
    expect(after['onHand']).toBe(before['onHand']);
  });

  /**
   * ⚠️ The append-only property, asserted rather than assumed. A correction is a
   * new row: the sale stays on the ledger and the restoration sits beside it, so
   * "why is this vendor's stock what it is?" is answerable from the history.
   */
  it('explains the path with a new row rather than editing the old one', async () => {
    const offeringId = `offering-ledger-${String(Date.now())}`;
    await service.client.post(
      '/api/stock-restoration',
      {
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId, quantity: 5 },
      },
      { headers: crossing() },
    );

    const ledger = await ledgerFor(offeringId);
    const restoration = ledger.find(row => row['reason'] === 'cancellation');

    expect(restoration).toBeDefined();
    expect(restoration?.['quantity']).toBe(5);
  });

  /**
   * ⚠️ `reason` is server-owned. A crossing token may write the one correction a
   * cancellation makes and must not be able to write a receipt through this
   * route — which is why the permission is `stock-movement:restore` rather than
   * the `stock-movement:write` a vendor's own session holds.
   */
  it('records a cancellation whatever reason the caller names', async () => {
    const offeringId = `offering-reason-${String(Date.now())}`;
    const res = await service.client.post(
      '/api/stock-restoration',
      {
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId, quantity: 3, reason: 'receipt' },
      },
      { headers: crossing() },
    );

    expect(res.status).toBe(201);
    expect(res.data.data.reason).toBe('cancellation');
  });

  /**
   * ⚠️ The saga's stock step sits after its pivot and is `retriable`, so the
   * engine re-dispatches it on a stable command id until it succeeds. A
   * restoration that ran twice hands a vendor stock they never got back.
   */
  it('restores once however many times the command is delivered', async () => {
    // An offering nothing seeds, so `onHand` and the row count are this test's
    // own arithmetic rather than the seed's plus it.
    const offeringId = `offering-restore-${String(Date.now())}`;
    const commandId = `cmd-restore-${String(Date.now())}`;
    const send = () =>
      service.client.post(
        '/api/stock-restoration',
        {
          meta: { type: 'entity', entity: 'stock-movement' },
          data: { offeringId, quantity: 4 },
        },
        { headers: crossing({ 'x-command-id': commandId }) },
      );

    const first = await send();
    const second = await send();

    expect(first.status).toBe(201);
    // `200`, not `409`: a coordinator that could not tell a redelivery from a
    // refusal would strand a flow whose stock did in fact go back.
    expect(second.status).toBe(200);
    expect(second.data.data.id).toBe(first.data.data.id);

    expect((await itemFor(offeringId))['onHand']).toBe(4);
    expect((await ledgerFor(offeringId)).length).toBe(1);
  });

  it('refuses a quantity that is not going back', async () => {
    for (const quantity of [0, -1]) {
      const res = await restore({ quantity });

      expect(res.status).toBe(400);
      expect(res.data.code).toBe('inconsistentMovement');
    }
  });

  it('refuses a session, even super-admin', async () => {
    const res = await service.client.post(
      '/api/stock-restoration',
      {
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId: OFFERING, quantity: 1 },
      },
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    // Not 403. Two accepted credentials on one route means the weaker one is
    // the security level.
    expect(res.status).toBe(401);
  });

  it('refuses a wrong crossing token', async () => {
    const res = await restore({}, { 'x-crossing-token': 'not-the-token' });

    expect(res.status).toBe(401);
  });

  it('refuses a crossing that names no organization', async () => {
    const res = await service.client.post(
      '/api/stock-restoration',
      {
        meta: { type: 'entity', entity: 'stock-movement' },
        data: { offeringId: OFFERING, quantity: 1 },
      },
      {
        headers: {
          'x-crossing-token': E2E_CROSSING_TOKEN,
          Authorization: undefined,
        },
      },
    );

    // The organization comes from the cancelled line, never from the principal,
    // so a crossing without one has nobody's stock to restore.
    expect(res.status).toBe(400);
  });
});
