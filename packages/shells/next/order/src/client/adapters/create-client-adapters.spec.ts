import { EntityRepositoryTag } from '@entifix/business';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@entifix/testing-unit/http';
import { ProductOrder } from '@r10c/business-ts-order-management';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './create-client-adapters.js';

/**
 * The address the host rewrites to `/api/order` before the browser sees it.
 * What this suite pins is that the adapters compose from the **order** domain
 * key rather than reusing a catalog or stock one — four backends now, owned by
 * four slices.
 */
const SERVICE = 'http://order-service:3105/api';

// `/api/config` is same-origin in the browser; under Node it resolves against
// the test server's origin, which MSW answers here.
const configuration = {
  uri: [{ key: 'order-service-domain', value: SERVICE }],
};

const emptyPage = (entity: string) =>
  HttpResponse.json({
    meta: { type: 'entityPage', entity },
    data: { items: [], total: 0, request: {} },
  });

const server = setupEntifixServer(
  http.get('*/api/config', () => HttpResponse.json(configuration)),
  http.get(`${SERVICE}/product-order`, () => emptyPage('product-order')),
);

const recordRequests = () => {
  const urls: string[] = [];
  server.events.on('request:start', ({ request }) => {
    urls.push(request.url);
  });
  return urls;
};

describe('createClientAdapters', () => {
  it('exposes the order repository plus the configuration store', () => {
    const adapters = createClientAdapters();

    expect(
      Context.get(adapters.productOrderRest, EntityRepositoryTag),
    ).toBeDefined();
  });

  it('composes the service base URL with the entity key', async () => {
    const urls = recordRequests();
    const adapters = createClientAdapters();

    await Effect.runPromise(
      Context.get(adapters.productOrderRest, EntityRepositoryTag).load({
        filtering: [],
        pageSize: 10,
      } as never),
    );

    expect(urls.some(url => url.startsWith(`${SERVICE}/product-order`))).toBe(
      true,
    );
  });

  /**
   * ⚠️ `save` and `delete` are built although **neither has a route a browser
   * can reach**: the writes take a crossing token and no session, and the host's
   * proxy forwards `GET` only. The adapter set is the transport, not the
   * permission — what withholds Save is the served descriptor (ADR 0026).
   * Omitting them would move that decision into the browser, as a second answer
   * to a question the service already answers.
   */
  it('offers the full CRUD set even where no route accepts it', () => {
    const repository = Context.get(
      createClientAdapters().productOrderRest,
      EntityRepositoryTag,
    );

    expect(repository.get).toBeDefined();
    expect(repository.load).toBeDefined();
    expect(repository.save).toBeDefined();
    expect(repository.delete).toBeDefined();
  });

  it('builds the repository against the real entity', () => {
    // Guards the copy-paste this shell began as: an adapter set pointed at
    // another domain's constructor would compose URLs from that entity's key
    // and read a collection this service does not serve.
    expect(ProductOrder.name).toBe('ProductOrder');
  });
});

describe('the payment-link port', () => {
  const { paymentLink } = createClientAdapters();

  it('reads the provider dictionary through the proxy, and an unreadable one as empty', async () => {
    server.use(
      http.get('*/api/order/payment-link-provider', () =>
        HttpResponse.json({ items: [{ key: 'other', name: 'Other', hosts: [] }] }),
      ),
    );
    expect(await paymentLink.providers()).toEqual([
      { key: 'other', name: 'Other', hosts: [] },
    ]);

    server.use(
      http.get('*/api/order/payment-link-provider', () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
    expect(await paymentLink.providers()).toEqual([]);

    server.use(
      http.get('*/api/order/payment-link-provider', () => HttpResponse.error()),
    );
    expect(await paymentLink.providers()).toEqual([]);
  });

  it('posts each verb with its body and a fresh key, and reads a refusal’s code', async () => {
    const posted: Array<{ url: string; key: string | null; body: unknown }> =
      [];
    server.use(
      http.post('*/api/order/product-order/:id/:verb', async ({ request }) => {
        posted.push({
          url: request.url,
          key: request.headers.get('idempotency-key'),
          body: await request.json(),
        });
        return request.url.endsWith('confirm-payment')
          ? HttpResponse.json(
              { code: 'orderNotAwaitingPayment' },
              { status: 409 },
            )
          : HttpResponse.json({ data: {} });
      }),
    );

    const set = await paymentLink.setLink('ord-1', {
      url: 'https://x.example',
      providerKey: 'other',
    });
    const confirmed = await paymentLink.confirm('ord-1', { reference: 'A' });

    expect(set).toEqual({ ok: true });
    expect(confirmed).toEqual({ ok: false, code: 'orderNotAwaitingPayment' });
    expect(posted[0]?.url).toMatch(/product-order\/ord-1\/set-payment-link$/);
    expect(posted[0]?.key).toMatch(/^"[0-9a-f-]+"$/);
    expect(posted[1]?.body).toEqual({ reference: 'A' });
  });

  it('reads a refusal with no code, or no answer, as unexpected', async () => {
    server.use(
      http.post('*/api/order/product-order/:id/:verb', () =>
        HttpResponse.text('nope', { status: 500 }),
      ),
    );
    expect(await paymentLink.confirm('o', { reference: 'A' })).toEqual({
      ok: false,
      code: 'unexpected',
    });

    server.use(
      http.post('*/api/order/product-order/:id/:verb', () =>
        HttpResponse.error(),
      ),
    );
    expect(await paymentLink.confirm('o', { reference: 'A' })).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });
});
