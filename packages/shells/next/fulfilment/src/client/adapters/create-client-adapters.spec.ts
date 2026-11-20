import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './create-client-adapters.js';

const server = setupEntifixServer();

describe('the guide port', () => {
  const { guide } = createClientAdapters();

  it('reads the courier dictionary through the proxy, and an unreadable one as empty', async () => {
    const other = { key: 'other', name: 'Other', trackingUrlTemplate: '' };
    server.use(
      http.get('*/api/fulfilment/courier', () =>
        HttpResponse.json({ items: [other] }),
      ),
    );
    expect(await guide.couriers()).toEqual([other]);

    server.use(
      http.get('*/api/fulfilment/courier', () => HttpResponse.json({})),
    );
    expect(await guide.couriers()).toEqual([]);

    server.use(
      http.get('*/api/fulfilment/courier', () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    expect(await guide.couriers()).toEqual([]);

    server.use(
      http.get('*/api/fulfilment/courier', () => HttpResponse.error()),
    );
    expect(await guide.couriers()).toEqual([]);
  });

  it('posts the guide with its body and a fresh key, and reads a refusal’s code', async () => {
    const posted: Array<{ url: string; key: string | null; body: unknown }> =
      [];
    server.use(
      http.post(
        '*/api/fulfilment/shipping-order/:id/record-guide',
        async ({ request, params }) => {
          posted.push({
            url: request.url,
            key: request.headers.get('idempotency-key'),
            body: await request.json(),
          });
          return params['id'] === 'gone'
            ? HttpResponse.json(
                { code: 'shippingOrderNotTransitionable' },
                { status: 409 },
              )
            : HttpResponse.json({ data: {} });
        },
      ),
    );

    const body = { courierKey: 'other', trackingNumber: 'G-1' };
    expect(await guide.record('so 1', body)).toEqual({ ok: true });
    expect(await guide.record('gone', body)).toEqual({
      ok: false,
      code: 'shippingOrderNotTransitionable',
    });
    expect(posted[0]?.url).toMatch(/shipping-order\/so%201\/record-guide$/);
    expect(posted[0]?.key).toMatch(/^"[0-9a-f-]+"$/);
    expect(posted[0]?.body).toEqual(body);
  });

  it('reads a refusal with no code, or no answer, as unexpected', async () => {
    server.use(
      http.post('*/api/fulfilment/shipping-order/:id/record-guide', () =>
        HttpResponse.text('nope', { status: 500 }),
      ),
    );
    const body = { courierKey: 'other', trackingNumber: 'G' };
    expect(await guide.record('s', body)).toEqual({
      ok: false,
      code: 'unexpected',
    });

    server.use(
      http.post('*/api/fulfilment/shipping-order/:id/record-guide', () =>
        HttpResponse.error(),
      ),
    );
    expect(await guide.record('s', body)).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });
});
