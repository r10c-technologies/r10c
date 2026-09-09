import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import {
  bearerFor,
  E2E_CROSSING_TOKEN,
  E2E_ORGANIZATION_ID,
} from '../support/tokens';

/**
 * Taking a hold, and refusing to.
 *
 * `mock`-only, and the reason is the seed rather than the mechanism: these
 * journeys move `reserved` on rows they name and assert the exact figure
 * afterwards, which only holds on a store nothing else has written to. The
 * conditional write itself is profile-agnostic — what a live run adds is
 * *contention*, and that is `concurrency.live.spec.ts`.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'STOCK_SERVICE_URL',
  startMock: startMockService,
  // A vendor's session, which every *read* here uses. The write below carries
  // no session at all — see the guard block.
  authorization: () => bearerFor(['admin']),
});

type Page = {
  status: number;
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
};

/**
 * `product-offering-1` is seeded with a single receipt of 10 and no holds, so
 * its availability is exactly 10 at the start of this file.
 */
const OFFERING = 'product-offering-1';
/** Seeded with no `StockItem` row at all — a different path from zero on hand. */
const UNSTOCKED = 'product-offering-41';

const crossing = (organizationId: string = E2E_ORGANIZATION_ID) => ({
  'x-crossing-token': E2E_CROSSING_TOKEN,
  'x-organization-id': organizationId,
  // ⚠️ Deliberately no `Authorization`. `defineServiceE2e` sets a default
  // header on the client, and axios merges per-request headers over it — so a
  // spec asserting that this route takes no session has to send the crossing
  // *instead of* a bearer, not beside it.
  Authorization: undefined,
});

const takeHold = (
  offeringId: string,
  quantity: number,
  headers: Record<string, string | undefined> = crossing(),
) =>
  service.client.post(
    '/api/reservation',
    {
      meta: { type: 'entity', entity: 'reservation' },
      data: { offeringId, quantity },
    },
    { headers },
  );

const itemFor = async (offeringId: string) => {
  const res: Page = await service.client.get(
    `/api/stock-item?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
  );
  return res.data.data.items[0];
};

const holdsFor = async (offeringId: string) => {
  const res: Page = await service.client.get(
    `/api/reservation?rsql=${encodeURIComponent(`offeringId==${offeringId}`)}`,
  );
  return res.data.data;
};

describe('taking a hold', () => {
  it('moves reserved without touching onHand', async () => {
    const before = await itemFor(OFFERING);

    const res = await takeHold(OFFERING, 2);

    expect(res.status).toBe(201);
    const after = await itemFor(OFFERING);
    expect(after['reserved']).toBe((before['reserved'] as number) + 2);
    // ⚠️ A purchase reserves rather than decrements. `onHand` is what the
    // vendor physically has, and it changes only when stock actually moves.
    expect(after['onHand']).toBe(before['onHand']);
  });

  it('owns the status and the expiry, whatever the body says', async () => {
    const res = await takeHold(OFFERING, 1);

    expect(res.status).toBe(201);
    expect(res.data.data.status).toBe('held');
    expect(typeof res.data.data.expiresAt).toBe('string');
    expect(typeof res.data.data.id).toBe('string');
  });

  it('writes a hold row the vendor can read back', async () => {
    const before = await holdsFor(OFFERING);

    await takeHold(OFFERING, 1);

    expect((await holdsFor(OFFERING)).total).toBe(before.total + 1);
  });
});

describe('refusing a hold', () => {
  it('answers 409 when the quantity is more than is available', async () => {
    const item = await itemFor(OFFERING);
    const available =
      (item['onHand'] as number) - (item['reserved'] as number) + 1;

    const res = await takeHold(OFFERING, available);

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('insufficientStock');
  });

  it('writes no hold row when it refuses', async () => {
    const before = await holdsFor(OFFERING);

    await takeHold(OFFERING, 10_000);

    // `matchedCount === 0` *is* the out-of-stock answer, so the insert never
    // runs — and the transaction is what guarantees the counter did not move
    // either.
    expect((await holdsFor(OFFERING)).total).toBe(before.total);
  });

  it('does not move reserved when it refuses', async () => {
    const before = await itemFor(OFFERING);

    await takeHold(OFFERING, 10_000);

    expect((await itemFor(OFFERING))['reserved']).toBe(before['reserved']);
  });

  it('answers 409 for an offering that has no stock row at all', async () => {
    // Not the same code path as zero on hand: the route deliberately does not
    // upsert, so an offering that never received stock has nothing to match.
    const res = await takeHold(UNSTOCKED, 1);

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('insufficientStock');
  });

  it('refuses a quantity that is not reservable', async () => {
    const zero = await takeHold(OFFERING, 0);
    const negative = await takeHold(OFFERING, -1);

    expect([zero.status, negative.status]).toEqual([400, 400]);
    expect(zero.data.code).toBe('invalidBody');
  });
});

/**
 * The crossing's guard, in the order it checks: fleet membership, then the
 * permission, then the organization — so nothing is revealed before the caller
 * is proven to be the fleet.
 */
describe('the crossing guard', () => {
  it('answers 401 without a crossing token', async () => {
    const res = await takeHold(OFFERING, 1, { Authorization: undefined });

    expect(res.status).toBe(401);
  });

  it('answers 401 for the wrong crossing token', async () => {
    const res = await takeHold(OFFERING, 1, {
      ...crossing(),
      'x-crossing-token': 'not-the-secret',
    });

    expect(res.status).toBe(401);
  });

  it('answers 400 when the crossing names no organization', async () => {
    // ⚠️ The header is checked **last**, after the token: the organization is
    // the input the caller controls, so it is never the input that authorizes.
    const res = await takeHold(OFFERING, 1, {
      ...crossing(),
      'x-organization-id': undefined,
    });

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidRequest');
  });

  it('answers 401 to a valid session with no crossing token', async () => {
    // ⚠️ **The property this whole route exists to hold.** `super-admin` holds
    // `*:*:*`, which matches every crossing permission — so a route that also
    // accepted a session would be reachable from an operator's browser tab, and
    // the weaker of two accepted credentials is the security level (ADR 0023).
    const res = await service.client.post(
      '/api/reservation',
      {
        meta: { type: 'entity', entity: 'reservation' },
        data: { offeringId: OFFERING, quantity: 1 },
      },
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    expect(res.status).toBe(401);
  });
});

describe('reading holds', () => {
  it('is session-guarded, not crossing-guarded', async () => {
    // The reads beside the crossing are ordinary tenant reads: one route, one
    // credential, each way. A crossing token is not a session and buys nothing
    // here.
    const res = await service.client.get('/api/reservation', {
      headers: crossing(),
    });

    expect(res.status).toBe(401);
  });
});
