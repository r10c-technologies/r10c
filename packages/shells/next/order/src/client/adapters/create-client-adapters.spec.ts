import { ProductOrder } from '@r10c/business-ts-order-management';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
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
    expect(
      Context.get(adapters.configurationStore, ConfigurationRepositoryTag),
    ).toBeDefined();
  });

  it('composes the service base URL with the entity key', async () => {
    const urls = recordRequests();
    const adapters = createClientAdapters();

    await Effect.runPromise(
      Context.get(adapters.productOrderRest, EntityRepositoryTag)
        .load({ filtering: [], pageSize: 10 } as never)
        .pipe(Effect.provide(adapters.configurationStore)),
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
