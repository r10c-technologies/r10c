import { StockItem, StockMovement } from '@r10c/business-ts-stock-management';
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
 * The address the host rewrites to `/api/stock` before the browser sees it.
 * What this suite pins is that the adapters compose from the **third** domain
 * key rather than reusing a catalog one — three backends now, owned by three
 * slices.
 */
const SERVICE = 'http://stock-service:3108/api';

// `/api/config` is same-origin in the browser; under Node it resolves against
// the test server's origin, which MSW answers here.
const configuration = {
  uri: [{ key: 'stock-service-domain', value: SERVICE }],
};

const emptyPage = (entity: string) =>
  HttpResponse.json({
    meta: { type: 'entityPage', entity },
    data: { items: [], total: 0, request: {} },
  });

const server = setupEntifixServer(
  http.get('*/api/config', () => HttpResponse.json(configuration)),
  http.get(`${SERVICE}/stock-item`, () => emptyPage('stock-item')),
  http.get(`${SERVICE}/stock-movement`, () => emptyPage('stock-movement')),
);

const recordRequests = () => {
  const urls: string[] = [];
  server.events.on('request:start', ({ request }) => {
    urls.push(request.url);
  });
  return urls;
};

describe('createClientAdapters', () => {
  it('exposes one repository per stock entity plus the configuration store', () => {
    const adapters = createClientAdapters();

    expect(Context.get(adapters.stockItemRest, EntityRepositoryTag)).toBeDefined();
    expect(
      Context.get(adapters.stockMovementRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(adapters.reservationRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(adapters.configurationStore, ConfigurationRepositoryTag),
    ).toBeDefined();
  });

  // Each entity gets its own context under the *same* tag, so a page merges
  // only the one it needs and the single tag never collides at the point of use.
  it('keeps each entity’s repository distinct', () => {
    const adapters = createClientAdapters();

    expect(Context.get(adapters.stockItemRest, EntityRepositoryTag)).not.toBe(
      Context.get(adapters.stockMovementRest, EntityRepositoryTag),
    );
  });

  it('composes the service base URL with the entity key', async () => {
    const urls = recordRequests();
    const adapters = createClientAdapters();
    const repository = Context.get(adapters.stockItemRest, EntityRepositoryTag);

    await Effect.runPromise(
      Effect.provide(
        repository.load<StockItem>({}),
        adapters.configurationStore,
      ),
    );

    expect(urls).toContain(`${SERVICE}/stock-item`);
  });

  it('reads the ledger from the same backend as the fold', async () => {
    // One slice, one store, one domain key — unlike the catalog, whose two
    // halves live in two services since ADR 0022.
    const urls = recordRequests();
    const adapters = createClientAdapters();
    const repository = Context.get(
      adapters.stockMovementRest,
      EntityRepositoryTag,
    );

    await Effect.runPromise(
      Effect.provide(
        repository.load<StockMovement>({}),
        adapters.configurationStore,
      ),
    );

    expect(urls).toContain(`${SERVICE}/stock-movement`);
  });

  /**
   * ⚠️ Plain REST, deliberately not the `202` command protocol. A movement has
   * no server-assigned member anyone waits for, this service runs no
   * transaction engine and its slice publishes no event — so a command create
   * would buy a tracker record and an outbox row for nothing.
   */
  it('offers a save on every repository, on the plain REST path', () => {
    const adapters = createClientAdapters();

    for (const context of [
      adapters.stockItemRest,
      adapters.stockMovementRest,
      adapters.reservationRest,
    ]) {
      expect(Context.get(context, EntityRepositoryTag).save).toBeDefined();
    }
  });

  it('returns a fresh adapter set per call', () => {
    expect(createClientAdapters()).not.toBe(createClientAdapters());
  });
});
