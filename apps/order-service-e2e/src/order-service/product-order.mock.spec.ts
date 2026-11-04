import { defineServiceE2e } from '@entifix/testing-e2e/service';

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
  // Every crossing write is idempotent on its key: a fresh one per call
  // unless a case names its own (ADR 0068).
  'idempotency-key': `"${crypto.randomUUID()}"`,
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

/**
 * The group every order here is written into, opened once: an order is placed
 * only into a group that exists (ADR 0069). Its vendor is the lab's
 * organization unless the lines name another.
 */
const SHARED_GROUP = crypto.randomUUID();

const ORDER_SHAPE = {
  vendorId: E2E_ORGANIZATION_ID,
  groupId: SHARED_GROUP,
  paymentMethod: 'card',
};

const openGroup = (id: string, data: Record<string, unknown> = {}) =>
  service.client.post(
    '/api/checkout-group',
    {
      meta: { type: 'entity', entity: 'checkout-group' },
      data: { id, buyerId: 'party-user-2', ...data },
    },
    { headers: crossing() },
  );

beforeAll(async () => {
  expect((await openGroup(SHARED_GROUP)).status).toBe(200);
});

const place = (
  items: ReadonlyArray<ReturnType<typeof line>>,
  extra: Record<string, string> = {},
) =>
  service.client.post(
    '/api/product-order',
    {
      meta: { type: 'entity', entity: 'product-order' },
      data: {
        ...ORDER_SHAPE,
        vendorId: items[0]?.vendorId ?? E2E_ORGANIZATION_ID,
        buyerId: 'party-user-2',
        items,
      },
    },
    { headers: crossing(extra) },
  );

const remove = (id: string) =>
  service.client.delete(`/api/product-order/${id}`, { headers: crossing() });

describe('placing an order', () => {
  it('writes it with its lines and answers 200', async () => {
    const res = await place([line('offering-a'), line('offering-b', 2)]);

    expect(res.status).toBe(200);
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

  /**
   * ⚠️ One order is one vendor's (ADR 0069). A basket spanning sellers is one
   * group of orders, so a write whose lines name two vendors is a basket split
   * wrongly upstream.
   */
  it('refuses a write whose lines name another vendor', async () => {
    const res = await place([
      { ...line('offering-e'), vendorId: 'vendor-a' },
      { ...line('offering-f'), vendorId: 'vendor-b' },
    ]);

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('refuses an order into a group nobody opened', async () => {
    const res = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: {
          ...ORDER_SHAPE,
          groupId: crypto.randomUUID(),
          items: [line('offering-orphan')],
        },
      },
      { headers: crossing() },
    );

    expect(res.status).toBe(404);
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
        data: { ...ORDER_SHAPE, items: [line('offering-g')] },
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
    expect(res.status).toBe(200);
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
          ...ORDER_SHAPE,
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
          ...ORDER_SHAPE,
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
          ...ORDER_SHAPE,
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
          ...ORDER_SHAPE,
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
      'idempotency-key': `"${commandId}"`,
    });
    const second = await place([line('offering-k')], {
      'idempotency-key': `"${commandId}"`,
    });

    expect(first.status).toBe(200);
    // `200`, not `409`: a coordinator that could not tell a duplicate from a
    // refusal would compensate an order it believes was never written, and
    // release holds that are still backing it. Replayed from the unit of
    // work's command claim, the one layer that records this write (ADR 0068).
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
 * The buyer's checkout group: the receipt across sellers, opened by the
 * checkout flow under its own id, holding the digest of the nonce a buyer's
 * cancel and receipt read are authorized by (ADR 0069).
 */
describe('the checkout group', () => {
  it('stamps a cancel window when the group brought a digest', async () => {
    const res = await openGroup(crypto.randomUUID(), {
      cancelDigest: 'a'.repeat(64),
    });

    expect(res.status).toBe(200);
    const placedAt = Date.parse(String(res.data.data.placedAt));
    const endsAt = Date.parse(String(res.data.data.cancelWindowEndsAt));
    // 30 minutes, the same number the storefront's receipt cookie lives for.
    expect(endsAt - placedAt).toBe(1800 * 1000);
  });

  it('stamps no window for a counter sale, which brings no digest', async () => {
    const res = await openGroup(crypto.randomUUID());

    expect(res.data.data.cancelWindowEndsAt).toBeUndefined();
  });

  it('owns the window whatever the body says', async () => {
    const res = await openGroup(crypto.randomUUID(), {
      cancelDigest: 'b'.repeat(64),
      cancelWindowEndsAt: '2099-01-01T00:00:00.000Z',
    });

    expect(Date.parse(String(res.data.data.cancelWindowEndsAt))).toBeLessThan(
      Date.parse('2099-01-01T00:00:00.000Z'),
    );
  });

  it('opens only under a flow’s id', async () => {
    const res = await openGroup('not-a-flow-id');

    expect(res.status).toBe(400);
    expect(res.data.code).toBe('invalidBody');
  });

  it('lists the vendor orders placed in it, and is shown to no vendor', async () => {
    const groupId = crypto.randomUUID();
    await openGroup(groupId);
    for (const vendorId of ['vendor-ga', 'vendor-gb']) {
      await service.client.post(
        '/api/product-order',
        {
          meta: { type: 'entity', entity: 'product-order' },
          data: {
            ...ORDER_SHAPE,
            vendorId,
            groupId,
            items: [{ ...line('offering-g'), vendorId }],
          },
        },
        { headers: crossing() },
      );
    }

    const asOperatorRead = await service.client.get(
      `/api/checkout-group/${groupId}`,
      { headers: await asOperator() },
    );
    const asVendorRead = await service.client.get(
      `/api/checkout-group/${groupId}`,
      { headers: await asVendorOf('vendor-ga') },
    );

    expect(asOperatorRead.data.data.orderIds).toHaveLength(2);
    expect(asVendorRead.status).toBe(404);
  });
});

/**
 * The two verbs a person can reach, and the three credentials around them.
 *
 * ⚠️ **Nothing here drives an order to `paid`, because nothing can.** The only
 * writer of that status is the `payment.captured` projection, so neither profile
 * can reach it from a request — which puts the *happy* paths of both verbs in
 * two other places by necessity rather than by choice: the stamping rule and the
 * status it derives are unit-tested in `order-transition.spec.ts`, and the flow
 * end to end is the live pass. What is asserted here is everything a request can
 * reach: which credential each route accepts, the scope it checks, and every
 * refusal.
 *
 * ⚠️ **One invariant is therefore proven only on the lab, and it is the one
 * worth naming.** Six simultaneous cancels of one paid order must produce
 * exactly one refund and exactly one stock restoration. The first build of the
 * claim answered a rival flow the same `200` it owes a redelivery, and that
 * measured **one refund and six restorations** — a vendor handed back five units
 * nobody bought. Nothing in this file could have caught it: reaching the claim's
 * success path needs a `paid` order, and a sequential run of six cancels would
 * have passed either way. A parallel burst against the live fleet is the test,
 * and it belongs in the verification notes rather than here.
 *
 * ⚠️ **The coordinator's address in this profile resolves nowhere on purpose.**
 * A route that got past its checks would hang on a dispatch, so every assertion
 * below stops short of one.
 */
const asVendorOf = async (organizationId: string) => ({
  Authorization: `Bearer ${await signTokenFor(
    ['admin'],
    'user-1',
    organizationId,
    'vendor',
    E2E_PARTY_ID,
  )}`,
});

const asOperator = async () => ({
  Authorization: `Bearer ${await signTokenFor(
    ['admin'],
    'user-1',
    null,
    'operator',
    null,
  )}`,
});

describe('the flows’ moves on an order', () => {
  const move = (id: string, step: string, body: object = {}) =>
    service.client.post(`/api/product-order/${id}/${step}`, body, {
      headers: crossing(),
    });

  it('confirms a pending cash-on-delivery order, dispatches it and closes it fulfilled', async () => {
    const placed = await place([line('offering-mv')]);
    const id = placed.data.data.id as string;

    const confirmed = await move(id, 'confirmed');
    const dispatched = await move(id, 'dispatched');
    const closed = await move(id, 'closed', { outcome: 'fulfilled' });

    expect(confirmed.data.data.status).toBe('confirmed');
    expect(dispatched.data.data.status).toBe('dispatched');
    expect(closed.data.data.status).toBe('fulfilled');
  });

  it('closes a dispatched parcel cancelled when it was refused or returned', async () => {
    const placed = await place([line('offering-mr')]);
    const id = placed.data.data.id as string;
    await move(id, 'confirmed');
    await move(id, 'dispatched');

    const closed = await move(id, 'closed', { outcome: 'cancelled' });

    expect(closed.data.data.status).toBe('cancelled');
  });

  it('refuses a move from the wrong place, naming where the order stood', async () => {
    const placed = await place([line('offering-mx')]);

    const res = await move(placed.data.data.id as string, 'dispatched');

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('orderNotTransitionable');
  });

  it('refuses a session, because a move is a flow’s step', async () => {
    const placed = await place([line('offering-ms')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/confirmed`,
      {},
      { headers: { Authorization: await bearerFor(['super-admin']) } },
    );

    expect(res.status).toBe(401);
  });
});

describe('the cancellation claim', () => {
  /**
   * ⚠️ The rule ADR 0058 §2 corrects: a `pending` order is a checkout still in
   * flight or a saga that stranded, and undoing one is the coordinator's job. A
   * second actor cancelling underneath it would race a compensation already on
   * its way.
   */
  it('refuses an order that is not paid', async () => {
    const placed = await place([line('offering-ca')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/cancelling`,
      {},
      { headers: crossing() },
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('orderNotCancellable');
  });

  it('answers 404 for an order that is not there', async () => {
    const res = await service.client.post(
      '/api/product-order/no-such-order/cancelling',
      {},
      { headers: crossing() },
    );

    expect(res.status).toBe(404);
  });

  it('refuses a session, because the claim is a saga step', async () => {
    const placed = await place([line('offering-cd')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/cancelling`,
      {},
      { headers: { Authorization: await bearerFor(['admin']) } },
    );

    expect(res.status).toBe(401);
  });

  /**
   * ⚠️ `200` with nothing to undo, for the reason every compensation in this
   * fleet answers so: delivery is at-least-once, and a compensation that errored
   * on its second delivery would strand a flow that had in fact been reversed.
   */
  it('releases a claim that was never taken, and says so', async () => {
    const placed = await place([line('offering-cc')]);

    const res = await service.client.delete(
      `/api/product-order/${placed.data.data.id as string}/cancelling`,
      { headers: crossing() },
    );

    expect(res.status).toBe(200);
    expect(res.data.outcome).toBe('not-claimed');
  });

  it('refuses a session on the release too', async () => {
    const placed = await place([line('offering-ce')]);

    const res = await service.client.delete(
      `/api/product-order/${placed.data.data.id as string}/cancelling`,
      { headers: { Authorization: await bearerFor(['admin']) } },
    );

    expect(res.status).toBe(401);
  });
});

describe('settling a cancellation', () => {
  /**
   * ⚠️ The conditional filter is the whole guard. An order nobody claimed must
   * not be walked to `cancelled` by a stray delivery, so the close refuses it
   * and names where it stood.
   */
  it('leaves an unclaimed order alone and says where it stood', async () => {
    const placed = await place([line('offering-sa')]);
    const id = placed.data.data.id as string;

    const res = await service.client.post(
      `/api/product-order/${id}/closed`,
      { outcome: 'cancelled' },
      { headers: crossing({ 'idempotency-key': '"cmd-settle-a"' }) },
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('orderNotTransitionable');
  });

  it('answers 404 for an order that is not there', async () => {
    const res = await service.client.post(
      '/api/product-order/no-such-order/closed',
      { outcome: 'cancelled' },
      { headers: crossing({ 'idempotency-key': '"cmd-settle-missing"' }) },
    );

    expect(res.status).toBe(404);
  });

  it('refuses a session, like every other step', async () => {
    const placed = await place([line('offering-sc')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/closed`,
      { outcome: 'cancelled' },
      { headers: { Authorization: await bearerFor(['admin']) } },
    );

    expect(res.status).toBe(401);
  });
});

describe('the buyer’s own cancel', () => {
  const NONCE = 'c'.repeat(64);

  const digestOfNonce = async (): Promise<string> => {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(NONCE, 'utf8').digest('hex');
  };

  /** An order placed in a group that carries the buyer's capability. */
  const withCapability = async (): Promise<string> => {
    const groupId = crypto.randomUUID();
    await openGroup(groupId, { cancelDigest: await digestOfNonce() });
    const res = await service.client.post(
      '/api/product-order',
      {
        meta: { type: 'entity', entity: 'product-order' },
        data: { ...ORDER_SHAPE, groupId, items: [line('offering-cap')] },
      },
      { headers: crossing() },
    );
    return res.data.data.id as string;
  };

  it('reads the receipt back by the capability in a header, and nothing without it', async () => {
    const id = await withCapability();
    const order = await service.client.get(`/api/product-order/${id}`, {
      headers: await asOperator(),
    });
    const groupId = order.data.data.groupId as string;

    const receipt = await service.client.get(
      `/api/checkout-group/${groupId}/buyer-receipt`,
      { headers: { Authorization: undefined, 'x-cancel-nonce': NONCE } },
    );
    const guessed = await service.client.get(
      `/api/checkout-group/${groupId}/buyer-receipt`,
      { headers: { Authorization: undefined, 'x-cancel-nonce': 'guess' } },
    );

    expect(receipt.status).toBe(200);
    expect(
      receipt.data.orders.map((o: { data: { id: string } }) => o.data.id),
    ).toEqual([id]);
    expect(guessed.status).toBe(401);
  });

  it('refuses a nonce that does not match, and says nothing about why', async () => {
    const id = await withCapability();

    const res = await service.client.post(
      `/api/product-order/${id}/buyer-cancellation`,
      { cancelNonce: 'd'.repeat(64) },
      { headers: { Authorization: undefined } },
    );

    expect(res.status).toBe(401);
    expect(res.data.code).toBe('cancelNotAuthorized');
  });

  it('refuses a request carrying no nonce at all', async () => {
    const id = await withCapability();

    const res = await service.client.post(
      `/api/product-order/${id}/buyer-cancellation`,
      {},
      { headers: { Authorization: undefined } },
    );

    expect(res.status).toBe(401);
  });

  /**
   * ⚠️ A counter sale's group carries no digest, because at a till there is no
   * browser to hold a nonce. "No capability was required" must never be
   * reachable from "no capability was presented".
   */
  it('refuses every nonce on an order whose group carries no digest', async () => {
    const placed = await place([line('offering-bc')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/buyer-cancellation`,
      { cancelNonce: NONCE },
      { headers: { Authorization: undefined } },
    );

    expect(res.status).toBe(401);
  });

  /**
   * ⚠️ `401` rather than `404`, so an order id cannot be confirmed to exist by
   * anyone presenting a nonce they do not have.
   */
  it('answers an absent order the same way it answers a bad nonce', async () => {
    const res = await service.client.post(
      '/api/product-order/no-such-order/buyer-cancellation',
      { cancelNonce: NONCE },
      { headers: { Authorization: undefined } },
    );

    expect(res.status).toBe(401);
    expect(res.data.code).toBe('cancelNotAuthorized');
  });

  /**
   * A valid capability against an order that is not `paid` yet. It is a `409`
   * rather than the blanket `401` above, because the caller has proved they may
   * ask — what they are being told is about the order, not about them.
   *
   * ⚠️ `paymentPending`, not `orderNotCancellable` (#387). A placed order is
   * `pending` until `payment.captured` is consumed, and the buyer reaches this
   * straight from the confirmation page, so "not yet" must not read as "never".
   */
  it('tells a buyer whose payment is still pending to retry', async () => {
    const id = await withCapability();

    const res = await service.client.post(
      `/api/product-order/${id}/buyer-cancellation`,
      { cancelNonce: NONCE },
      { headers: { Authorization: undefined } },
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('paymentPending');
  });
});

describe('a vendor or operator asking to cancel', () => {
  /**
   * ⚠️ Each vendor's order is theirs alone (ADR 0069): in one group, vendor A
   * may ask to cancel A's order and is not even shown B's.
   */
  it('lets vendor A ask about only their own order in a shared group', async () => {
    const groupId = crypto.randomUUID();
    await openGroup(groupId);
    const write = (vendorId: string) =>
      service.client.post(
        '/api/product-order',
        {
          meta: { type: 'entity', entity: 'product-order' },
          data: {
            ...ORDER_SHAPE,
            vendorId,
            groupId,
            items: [{ ...line('offering-vab'), vendorId }],
          },
        },
        { headers: crossing() },
      );
    const a = await write('vendor-va');
    const b = await write('vendor-vb');

    const own = await service.client.post(
      `/api/product-order/${a.data.data.id as string}/cancel`,
      {},
      { headers: await asVendorOf('vendor-va') },
    );
    const theirs = await service.client.post(
      `/api/product-order/${b.data.data.id as string}/cancel`,
      {},
      { headers: await asVendorOf('vendor-va') },
    );

    // Their own pending order is refused on its status, not on who asked.
    expect(own.status).toBe(409);
    expect(own.headers['content-type']).toContain('application/problem+json');
    expect(own.data.code).toBe('orderNotCancellable');
    expect(theirs.status).toBe(404);
  });

  it('refuses an operator an order that is not paid', async () => {
    const placed = await place([line('offering-ve')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/cancel`,
      {},
      { headers: await asOperator() },
    );

    expect(res.status).toBe(409);
    expect(res.data.code).toBe('orderNotCancellable');
  });

  it('answers 404 to a vendor the order does not belong to', async () => {
    const placed = await place([
      { ...line('offering-vc'), vendorId: 'vendor-vc' },
    ]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/cancel`,
      {},
      { headers: await asVendorOf('vendor-elsewhere') },
    );

    expect(res.status).toBe(404);
  });

  it('refuses a crossing token, because asking is a person’s act', async () => {
    const placed = await place([line('offering-vd')]);

    const res = await service.client.post(
      `/api/product-order/${placed.data.data.id as string}/cancel`,
      {},
      { headers: crossing() },
    );

    expect(res.status).toBe(401);
  });
});
