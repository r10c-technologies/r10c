import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The checkout server action, over a stubbed `fetch`.
 *
 * What is under test is the part a live run cannot easily force: that the price
 * travels from the *published offering* rather than from the cart cookie, that a
 * vanished line is dropped rather than failing the basket, that the cart
 * survives a refusal, and that the coordinator's `409` reaches the buyer as a
 * stock answer instead of an error.
 *
 * `getOffering` and `next/*` are mocked because this module is a **server
 * action**: it reads cookies and redirects, neither of which exists outside a
 * request, and its one real dependency is the price lookup.
 */

const setCookie = vi.fn();
const redirect = vi.fn((path: string) => {
  // `redirect` throws to unwind the action, and the code under test depends on
  // that: a stub that returned would let execution continue past it.
  throw new Error(`REDIRECT:${path}`);
});
const getOffering = vi.fn();
const readCart = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: setCookie }),
}));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));
vi.mock('../catalog/queries', () => ({
  getOffering: (id: string) => getOffering(id),
}));
vi.mock('./cart-cookie', () => ({ readCart: () => readCart() }));

const offering = (overrides: Record<string, unknown> = {}) => ({
  vendorId: 'vendor-a',
  amount: 1999,
  currency: 'GTQ',
  ...overrides,
});

/**
 * Runs the action and returns the path it redirected to.
 *
 * ⚠️ `locale` takes **`null`**, not `undefined`, to mean "the form carries
 * none": passing `undefined` to a parameter with a default triggers the default,
 * which is the same trap `stock-service-e2e`'s `bearerFor` records.
 */
const run = async (locale: string | null = 'es'): Promise<string> => {
  const { checkout } = await import('./checkout-action.js');
  const form = new FormData();
  if (locale !== null) form.set('locale', locale);
  try {
    await checkout(form);
  } catch (error) {
    return String((error as Error).message).replace('REDIRECT:', '');
  }
  throw new Error('the action did not redirect');
};

const fetchMock = vi.fn();

/** One line as order-service writes it back. */
const orderLine = (offeringId = 'o-1', quantity = 2) => ({
  offeringId,
  vendorId: 'vendor-a',
  quantity,
  amount: 1999,
  currency: 'GTQ',
});

/**
 * The coordinator's `201`, shaped as it really is: one outcome per step, each
 * carrying the participant's own response body verbatim. The order the
 * confirmation page renders comes out of `write-order`'s, so a spec that
 * answered a bare `{ status: 201 }` would exercise the failure path instead.
 */
const sagaResponse = (
  items: ReadonlyArray<ReturnType<typeof orderLine>> = [orderLine()],
  order: Record<string, unknown> = {},
) => ({
  status: 201,
  json: () =>
    Promise.resolve({
      meta: { type: 'sagaResult', entity: 'checkout' },
      data: {
        sagaId: 'saga-1',
        state: 'COMPLETED',
        outcomes: [
          { stepId: 'reserve', calls: [{ index: 0, status: 201, body: {} }] },
          {
            stepId: 'write-order',
            calls: [
              {
                index: 0,
                status: 201,
                body: {
                  meta: { type: 'entity', entity: 'product-order' },
                  data: {
                    id: 'order-1',
                    status: 'pending',
                    placedAt: '2026-09-09T00:00:00.000Z',
                    cancelWindowEndsAt: '2026-09-09T00:30:00.000Z',
                    items,
                    ...order,
                  },
                },
              },
            ],
          },
        ],
      },
    }),
});

const receiptCookie = () => {
  const call = setCookie.mock.calls.find(args => args[0] === 'r10c_receipt');
  return call ? JSON.parse(String(call[1])) : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(sagaResponse());
  getOffering.mockImplementation(() => Promise.resolve(offering()));
  readCart.mockResolvedValue([{ offeringId: 'o-1', quantity: 2 }]);
});

describe('checkout', () => {
  it('places the order and sends the buyer to their receipt', async () => {
    expect(await run()).toBe('/es/order/confirmation');
  });

  /**
   * ⚠️ The price is captured from the published offering, not from the cart
   * cookie — which carries only an id and a quantity. A buyer must be charged
   * the price they were shown, and an offering's price can change between the
   * cart and the payment.
   */
  it('prices each line from the published offering', async () => {
    await run();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.inputs['write-order'][0].body.data.items).toEqual([
      {
        offeringId: 'o-1',
        vendorId: 'vendor-a',
        quantity: 2,
        amount: 1999,
        currency: 'GTQ',
      },
    ]);
  });

  /**
   * ⚠️ The organization comes from the *item*, because a buyer's session names
   * none and never will (ADR 0023).
   */
  it('takes the hold against the vendor named on the offering', async () => {
    await run();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.inputs.reserve).toEqual([
      {
        organizationId: 'vendor-a',
        body: {
          meta: { type: 'entity', entity: 'reservation' },
          data: { offeringId: 'o-1', quantity: 2 },
        },
      },
    ]);
  });

  it('fans the reserve step out once per line', async () => {
    readCart.mockResolvedValue([
      { offeringId: 'o-1', quantity: 1 },
      { offeringId: 'o-2', quantity: 3 },
    ]);
    getOffering.mockImplementation((id: string) =>
      Promise.resolve(offering({ vendorId: id === 'o-1' ? 'v-a' : 'v-b' })),
    );

    await run();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(
      body.inputs.reserve.map(
        (r: { organizationId: string }) => r.organizationId,
      ),
    ).toEqual(['v-a', 'v-b']);
  });

  it('sends the crossing token and never a session', async () => {
    await run();

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['x-crossing-token']).toBe(
      'dev-saga-crossing-token-change-me',
    );
    expect(headers['Authorization']).toBeUndefined();
  });

  it('never caches the call', async () => {
    await run();

    // A cached checkout is a buyer told their order succeeded because somebody
    // else's did.
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });

  it('clears the cart only after the order is written', async () => {
    await run();

    // ⚠️ The same `path` the cart was written with. Expiring it on another path
    // sets a second cookie instead, and the browser keeps sending the first —
    // a cart that empties on screen and returns on the next request.
    expect(setCookie).toHaveBeenCalledWith(
      'r10c_cart',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  /**
   * ⚠️ `409` is the saga's own "compensated": a line was refused and every hold
   * taken has been given back. The cart must survive, because the buyer can act
   * on it.
   */
  it('keeps the cart when the saga compensated', async () => {
    fetchMock.mockResolvedValue({ status: 409 });

    expect(await run()).toBe('/es/cart?checkout=unavailable');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('keeps the cart when the coordinator answers anything else', async () => {
    fetchMock.mockResolvedValue({ status: 500 });

    expect(await run()).toBe('/es/cart?checkout=failed');
    expect(setCookie).not.toHaveBeenCalled();
  });

  it('keeps the cart when the coordinator cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await run()).toBe('/es/cart?checkout=failed');
  });

  /**
   * A line whose offering was unpublished since it was added is dropped rather
   * than failing the basket: refusing the whole cart for one vanished item is
   * worse for the buyer than checking out the rest.
   */
  it('drops a line whose offering has vanished', async () => {
    readCart.mockResolvedValue([
      { offeringId: 'gone', quantity: 1 },
      { offeringId: 'o-2', quantity: 1 },
    ]);
    getOffering.mockImplementation((id: string) =>
      Promise.resolve(id === 'gone' ? undefined : offering()),
    );

    await run();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.inputs.reserve).toHaveLength(1);
  });

  it('does not call the coordinator when nothing is left to buy', async () => {
    readCart.mockResolvedValue([{ offeringId: 'gone', quantity: 1 }]);
    getOffering.mockResolvedValue(undefined);

    expect(await run()).toBe('/es/cart?checkout=empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The locale comes off the form, and a form without one still has to land
   * somewhere rather than throwing inside a server action — where the failure
   * would reach the buyer as an unhandled error rather than as a cart page.
   */
  it('still redirects when the form carries no locale', async () => {
    expect(await run(null)).toBe('//order/confirmation');
  });

  it('carries the written order into the receipt cookie', async () => {
    await run();

    // Nothing is re-fetched to build this: the saga's own answer contains the
    // order, which is what lets a page with no session render a receipt.
    expect(receiptCookie()).toEqual({
      orderId: 'order-1',
      placedAt: '2026-09-09T00:00:00.000Z',
      cancelNonce: expect.any(String),
      cancelWindowEndsAt: '2026-09-09T00:30:00.000Z',
      lines: [
        { offeringId: 'o-1', quantity: 2, amount: 1999, currency: 'GTQ' },
      ],
      lineCount: 1,
      totals: [{ currency: 'GTQ', amount: 3998 }],
    });
  });

  /**
   * ⚠️ The digest goes to the server and the nonce stays in the cookie, and this
   * is the assertion that keeps them from swapping places. The order write is
   * the checkout saga's own step, so anything the request carries is persisted
   * in the `saga` store and served to every vendor in the basket — a bearer
   * token there would let one of them cancel an order their session cannot.
   */
  it('sends the digest to the order and keeps the nonce in the cookie', async () => {
    await run();

    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const digest = sent.inputs['write-order'][0].body.data.cancelDigest;
    const receipt = receiptCookie();

    expect(typeof digest).toBe('string');
    expect(digest).toHaveLength(64);
    expect(typeof receipt.cancelNonce).toBe('string');
    expect(receipt.cancelNonce).not.toBe(digest);
    // The digest the server stored is the digest of the nonce the buyer holds.
    expect(
      createHash('sha256')
        .update(String(receipt.cancelNonce), 'utf8')
        .digest('hex'),
    ).toBe(digest);
    expect(receipt.cancelWindowEndsAt).toBe('2026-09-09T00:30:00.000Z');
  });

  /**
   * ⚠️ A nonce with no window is a secret that opens nothing. Carrying it would
   * put a Cancel button on a page whose request is bound to fail — which is what
   * a counter sale's receipt, and any order placed before the capability
   * existed, actually look like.
   */
  it('carries no nonce when the server stamped no window', async () => {
    fetchMock.mockResolvedValue(
      sagaResponse([orderLine()], { cancelWindowEndsAt: undefined }),
    );

    await run();

    expect(receiptCookie().cancelNonce).toBeUndefined();
    expect(receiptCookie().cancelWindowEndsAt).toBeUndefined();
  });

  it('keeps the receipt out of the browser and short-lived', async () => {
    await run();

    const options = setCookie.mock.calls.find(
      args => args[0] === 'r10c_receipt',
    )?.[2];
    expect(options).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1800,
      }),
    );
  });

  /**
   * ⚠️ A cookie is 4KB and a basket has no upper bound, so past the cap the
   * receipt keeps the identity and the totals and drops the lines. A truncated
   * list rendered as the whole order would be a receipt that lies.
   */
  it('drops the lines rather than truncating them past the cap', async () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      orderLine(`o-${index}`, 1),
    );
    fetchMock.mockResolvedValue(sagaResponse(many));

    await run();

    const receipt = receiptCookie();
    expect(receipt.lines).toBeUndefined();
    expect(receipt.lineCount).toBe(13);
    expect(receipt.totals).toEqual([{ currency: 'GTQ', amount: 13 * 1999 }]);
  });

  /**
   * ⚠️ Found on the live fleet, where the seed prices in two currencies: a
   * basket spanning vendors summed into one figure and labelled with whichever
   * currency came first, which states a price nobody was charged.
   */
  it('totals a mixed-currency basket per currency', async () => {
    fetchMock.mockResolvedValue(
      sagaResponse([
        orderLine('o-1', 1),
        { ...orderLine('o-2', 2), currency: 'USD', amount: 500 },
      ]),
    );

    await run();

    expect(receiptCookie().totals).toEqual([
      { currency: 'GTQ', amount: 1999 },
      { currency: 'USD', amount: 1000 },
    ]);
  });

  /**
   * ⚠️ The order is written by this point. Telling the buyer it failed because
   * the response could not be read would be a lie with a receipt behind it.
   */
  it('still reports a placed order when the body cannot be read', async () => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: () => Promise.reject(new Error('not json')),
    });

    expect(await run()).toBe('/es/cart?checkout=placed');
    expect(receiptCookie()).toBeUndefined();
  });

  /**
   * Every shape between a `201` and a renderable order. None of them may fail
   * the checkout, and none may produce a half-built receipt: the read either
   * yields the whole order or nothing, and "nothing" lands the buyer on the
   * cart's success banner.
   */
  it.each([
    ['a payload that is not an object', 'not an object'],
    ['no data', {}],
    ['outcomes that are not a list', { data: { outcomes: 'none' } }],
    ['no write-order step', { data: { outcomes: [{ stepId: 'reserve' }] } }],
    [
      'a write-order step with no calls',
      { data: { outcomes: [{ stepId: 'write-order', calls: [] }] } },
    ],
    [
      'a call with no body',
      { data: { outcomes: [{ stepId: 'write-order', calls: [{}] }] } },
    ],
    [
      'a body carrying no entity',
      {
        data: {
          outcomes: [
            { stepId: 'write-order', calls: [{ body: { meta: {} } }] },
          ],
        },
      },
    ],
    [
      'an order with no id',
      {
        data: {
          outcomes: [
            {
              stepId: 'write-order',
              calls: [{ body: { data: { items: [] } } }],
            },
          ],
        },
      },
    ],
    [
      'an order whose items are not a list',
      {
        data: {
          outcomes: [
            {
              stepId: 'write-order',
              calls: [{ body: { data: { id: 'order-1', items: 3 } } }],
            },
          ],
        },
      },
    ],
  ])('still reports a placed order given %s', async (_name, payload) => {
    fetchMock.mockResolvedValue({
      status: 201,
      json: () => Promise.resolve(payload),
    });

    expect(await run()).toBe('/es/cart?checkout=placed');
    expect(receiptCookie()).toBeUndefined();
  });

  it('drops a line the order did not describe fully', async () => {
    fetchMock.mockResolvedValue(
      sagaResponse([
        orderLine('o-1', 1),
        { offeringId: 'o-2' } as unknown as ReturnType<typeof orderLine>,
        'not a line' as unknown as ReturnType<typeof orderLine>,
      ]),
    );

    await run();

    // The receipt is still written: an order that arrived with one unreadable
    // line is not a reason to tell the buyer nothing about the rest.
    expect(receiptCookie().lines).toEqual([
      { offeringId: 'o-1', quantity: 1, amount: 1999, currency: 'GTQ' },
    ]);
  });

  it('omits placedAt when the order carries none', async () => {
    fetchMock.mockResolvedValue(sagaResponse([orderLine()], { placedAt: 7 }));

    await run();

    expect(receiptCookie().placedAt).toBeUndefined();
  });

  it('does not call the coordinator for an empty cart', async () => {
    readCart.mockResolvedValue([]);

    expect(await run()).toBe('/es/cart?checkout=empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
