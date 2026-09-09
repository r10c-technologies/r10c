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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ status: 201 });
  getOffering.mockImplementation(() => Promise.resolve(offering()));
  readCart.mockResolvedValue([{ offeringId: 'o-1', quantity: 2 }]);
});

describe('checkout', () => {
  it('places the order and reports it', async () => {
    expect(await run()).toBe('/es/cart?checkout=placed');
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

    expect(setCookie).toHaveBeenCalledWith(
      'r10c_cart',
      '',
      expect.objectContaining({ maxAge: 0 }),
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
    expect(await run(null)).toBe('//cart?checkout=placed');
  });

  it('does not call the coordinator for an empty cart', async () => {
    readCart.mockResolvedValue([]);

    expect(await run()).toBe('/es/cart?checkout=empty');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
