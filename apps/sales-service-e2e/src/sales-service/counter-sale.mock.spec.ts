import { defineServiceE2e } from '@r10c/entifix-ts-testing-e2e/service';

import { startMockService } from '../support/mock-service';
import { bearerFor, signTokenFor } from '../support/tokens';

/**
 * What `POST /api/counter-sale` refuses **before** it presents the coordinator's
 * crossing token.
 *
 * `mock`-only, and the boundary is exactly where the value is. Everything
 * asserted here happens before the first outbound call: the session, the verb,
 * the channel's own tenant handle and the channel's state. What happens after —
 * the reserve, the order, the capture, the conversion — needs the real
 * coordinator and the real participants, so it is a live journey rather than a
 * mock one. A saga dispatched at a fake would assert that this service can
 * compose a request and nothing about whether a sale happened.
 */
const service = defineServiceE2e({
  liveUrlEnvVar: 'SALES_SERVICE_URL',
  startMock: startMockService,
});

const sell = async (
  body: unknown,
  authorization?: string,
): Promise<{ status: number; data: Record<string, unknown> }> =>
  service.client.post('/api/counter-sale', body, {
    headers:
      authorization === undefined ? {} : { Authorization: authorization },
  });

const ONE_LINE = {
  channelId: 'sales-channel-counter',
  paymentMethod: 'cash',
  lines: [{ offeringId: 'product-offering-1', quantity: 1 }],
};

describe('the till`s one write', () => {
  it('is refused 401 without a session', async () => {
    expect((await sell(ONE_LINE)).status).toBe(401);
  });

  it('is refused 403 for a principal holding no grant at all', async () => {
    // ⚠️ Both `admin` and `user` may sell — staff at a till are `user`, and the
    // verb exists precisely so that ringing up a sale is not an administrative
    // act. So the negative case is a token with no roles rather than a lesser
    // role.
    const token = await signTokenFor([]);

    expect((await sell(ONE_LINE, `Bearer ${token}`)).status).toBe(403);
  });

  it('is refused 409 for a principal who has picked no organization', async () => {
    const token = await signTokenFor(['admin'], 'user-1', null);

    const res = await sell(ONE_LINE, `Bearer ${token}`);

    expect(res.status).toBe(409);
    expect(res.data['code']).toBe('noActiveOrganization');
  });

  it.each([
    ['no channel', { paymentMethod: 'cash', lines: ONE_LINE.lines }],
    ['no lines', { channelId: 'sales-channel-counter', paymentMethod: 'cash', lines: [] }],
    [
      'a fractional quantity',
      {
        channelId: 'sales-channel-counter',
        paymentMethod: 'cash',
        lines: [{ offeringId: 'product-offering-1', quantity: 1.5 }],
      },
    ],
    [
      'a quantity of zero',
      {
        channelId: 'sales-channel-counter',
        paymentMethod: 'cash',
        lines: [{ offeringId: 'product-offering-1', quantity: 0 }],
      },
    ],
  ])('is refused 400 for a sale with %s', async (_shape, body) => {
    const res = await sell(body, await bearerFor(['admin']));

    expect(res.status).toBe(400);
    expect(res.data['code']).toBe('invalidBody');
  });

  it('is refused 404 for a channel this organization does not have', async () => {
    // Not 403: the id is the store's primary key, and a 403 would make the route
    // an oracle for which channels exist in other vendors' stores.
    const res = await sell(
      { ...ONE_LINE, channelId: 'sales-channel-somebody-elses' },
      await bearerFor(['admin']),
    );

    expect(res.status).toBe(404);
    expect(res.data['code']).toBe('notFound');
  });

  it('is refused 409 through a channel that has been retired', async () => {
    // A retired channel stays readable, because every order placed through it
    // keeps naming it — so it stays *pickable* by anything that does not check,
    // and the refusal has to be the route's rather than the screen's.
    const created: { data: { data: Record<string, unknown> } } =
      await service.client.post(
        '/api/sales-channel',
        {
          meta: { type: 'entity', entity: 'sales-channel' },
          data: {
            name: `e2e-retired-${Date.now()}`,
            type: 'counter',
            status: 'inactive',
          },
        },
        { headers: { Authorization: await bearerFor(['admin']) } },
      );

    const res = await sell(
      { ...ONE_LINE, channelId: created.data.data['id'] as string },
      await bearerFor(['admin']),
    );

    expect(res.status).toBe(409);
    expect(res.data['code']).toBe('channelInactive');
  });
});
