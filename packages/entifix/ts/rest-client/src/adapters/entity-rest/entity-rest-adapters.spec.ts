import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { stubUriConfigurationLayer } from '@r10c/entifix-ts-testing-unit';
import {
  entityRestHandlers,
  http,
  HttpResponse,
  respondWith404,
  respondWith500,
  respondWithMalformedEnvelope,
  respondWithNetworkError,
  respondWithNonJson,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildEntityRestAdapterDelete } from './build-entity-rest-adapter-delete/index.js';
import { buildEntityRestAdapterGet } from './build-entity-rest-adapter-get/index.js';
import { buildEntityRestAdapterLoad } from './build-entity-rest-adapter-load/index.js';
import { buildEntityRestAdapterSave } from './build-entity-rest-adapter-save/index.js';
import type { BuildEntityRestOptions } from './types.js';

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

/** No `key`, so the URL must be built from the class name instead. */
@entity()
class Unkeyed implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const BASE_URL = 'http://service/api/widget';

const restOptions: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
};

const configuration = stubUriConfigurationLayer(
  { widget: BASE_URL, Unkeyed: 'http://service/api/Unkeyed' },
  { keyTemplate: 'service-domain.[entity]', group: 'uri' },
);

const makeWidget = (id: EntityId, name: string): Widget => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  return widget;
};

let rows: Widget[] = [];

// Every request goes through MSW, so what is asserted is the wire — method,
// URL and envelope — rather than that some function received an object.
const server = setupEntifixServer();

beforeEach(() => {
  rows = [makeWidget('w-1', 'Alpha'), makeWidget('w-2', 'Beta'), makeWidget('w-3', 'Gamma')];
  server.use(...entityRestHandlers(Widget, { baseUrl: BASE_URL, data: rows }));
});

const recordRequests = () => {
  const requests: { method: string; url: string }[] = [];
  server.events.on('request:start', ({ request }) => {
    requests.push({ method: request.method, url: request.url });
  });
  return requests;
};

const runLoad = (request: Parameters<ReturnType<typeof buildEntityRestAdapterLoad<Widget>>>[0]) =>
  Effect.runPromise(
    buildEntityRestAdapterLoad(Widget, restOptions)(request).pipe(
      Effect.provide(configuration),
    ),
  );

const runGet = (id: string): Promise<Widget> =>
  Effect.runPromise(
    buildEntityRestAdapterGet(Widget, restOptions)<Widget>(id).pipe(
      Effect.provide(configuration),
    ),
  );

const runDelete = (entityOrId: EntityId | Widget) =>
  Effect.runPromise(
    buildEntityRestAdapterDelete(Widget, restOptions)(entityOrId).pipe(
      Effect.provide(configuration),
    ),
  );

describe('buildEntityRestAdapterLoad', () => {
  it('GETs the collection endpoint named after the entity key', async () => {
    const requests = recordRequests();

    await runLoad({});

    expect(requests).toContainEqual({ method: 'GET', url: BASE_URL });
  });

  it('falls back to the class name when the entity declares no key', async () => {
    const requests = recordRequests();
    server.use(...entityRestHandlers(Unkeyed, { baseUrl: 'http://service/api/Unkeyed' }));

    await Effect.runPromise(
      buildEntityRestAdapterLoad(Unkeyed, restOptions)({}).pipe(
        Effect.provide(configuration),
      ),
    );

    expect(requests).toContainEqual({
      method: 'GET',
      url: 'http://service/api/Unkeyed',
    });
  });

  it('deserializes the page envelope into entity instances', async () => {
    const page = await runLoad({});

    expect(page.items).toHaveLength(3);
    expect(page.items[0]).toBeInstanceOf(Widget);
    expect(page.total).toBe(3);
  });

  it.each([
    ['page only', { page: 2 }, 'page=2'],
    ['pageSize only', { pageSize: 5 }, 'pageSize=5'],
  ])('sends %s as a query parameter', async (_label, request, expected) => {
    const requests = recordRequests();

    await runLoad(request);

    expect(requests[0]?.url).toBe(`${BASE_URL}?${expected}`);
  });

  it('sends both paging parameters together', async () => {
    const requests = recordRequests();

    await runLoad({ page: 2, pageSize: 2 });

    expect(requests[0]?.url).toBe(`${BASE_URL}?page=2&pageSize=2`);
  });

  // The envelope echoes the request the *service* served. The caller's own
  // request carries its filtering/sorting types, so that is what comes back.
  it('returns the caller’s request rather than the echoed one', async () => {
    const request = { page: 1, pageSize: 2 };

    const page = await runLoad(request);

    expect(page.request).toBe(request);
  });

  it.each([
    ['a non-envelope body', () => respondWithMalformedEnvelope(BASE_URL), /no meta.type/],
    ['a non-JSON body', () => respondWithNonJson(BASE_URL), /parse response body/],
    ['an error status', () => respondWith500(BASE_URL), /status 500/],
    ['a dropped connection', () => respondWithNetworkError(BASE_URL), /failed/],
  ])('fails on %s', async (_label, handler, message) => {
    server.use(handler());

    await expect(runLoad({})).rejects.toThrow(message);
  });
});

describe('buildEntityRestAdapterGet', () => {
  it('GETs the entity’s own URL', async () => {
    const requests = recordRequests();

    await runGet('w-1');

    expect(requests).toContainEqual({ method: 'GET', url: `${BASE_URL}/w-1` });
  });

  it('deserializes the entity envelope into an instance', async () => {
    const widget = await runGet('w-1');

    expect(widget).toBeInstanceOf(Widget);
    expect(widget.name).toBe('Alpha');
  });

  it('fails when the entity is not found', async () => {
    await expect(runGet('missing')).rejects.toThrow(/status 404/);
  });

  it('fails when the response is not an envelope', async () => {
    server.use(respondWithMalformedEnvelope(`${BASE_URL}/:id`));

    await expect(runGet('w-1')).rejects.toThrow(/no meta.type/);
  });
});

describe('buildEntityRestAdapterDelete', () => {
  it('DELETEs the entity’s own URL, given an id', async () => {
    const requests = recordRequests();

    await runDelete('w-1');

    expect(requests).toContainEqual({ method: 'DELETE', url: `${BASE_URL}/w-1` });
  });

  // The repository contract accepts either shape, so the adapter has to reduce
  // a whole entity to its id rather than serializing it into the URL.
  it('accepts a whole entity and deletes by its id', async () => {
    const requests = recordRequests();

    await runDelete(makeWidget('w-2', 'Beta'));

    expect(requests).toContainEqual({ method: 'DELETE', url: `${BASE_URL}/w-2` });
  });

  it('removes the entity server-side', async () => {
    await runDelete('w-1');

    expect(rows.map((row) => row.id)).toEqual(['w-2', 'w-3']);
  });

  it('accepts a numeric id', async () => {
    const requests = recordRequests();
    server.use(
      http.delete(`${BASE_URL}/:id`, () =>
        HttpResponse.json({ meta: { type: 'entity', entity: 'widget' }, data: {} }),
      ),
    );

    await runDelete(7);

    expect(requests).toContainEqual({ method: 'DELETE', url: `${BASE_URL}/7` });
  });

  // Deleting without an id would hit the collection endpoint and, on a
  // permissive service, delete everything — so it fails before any request.
  it.each([
    ['a bare undefined', undefined],
    ['a null', null as unknown as EntityId],
    ['an entity with no id', makeWidget(undefined, 'Unsaved')],
  ])('refuses to issue a request for %s', async (_label, entityOrId) => {
    const requests = recordRequests();

    await expect(runDelete(entityOrId)).rejects.toThrow(/without an id/);
    expect(requests).toEqual([]);
  });

  it('fails when the service rejects the delete', async () => {
    server.use(respondWith404(`${BASE_URL}/:id`, 'delete'));

    await expect(runDelete('w-1')).rejects.toThrow(/status 404/);
  });
});

// The endpoint is derived from `key ?? name` in every adapter, so an entity
// that declares no key must still route somewhere rather than to `undefined`.
describe('the entity key fallback', () => {
  const UNKEYED_URL = 'http://service/api/Unkeyed';

  beforeEach(() => {
    server.use(...entityRestHandlers(Unkeyed, { baseUrl: UNKEYED_URL, data: [] }));
  });

  it('routes a get through the class name', async () => {
    const requests = recordRequests();
    server.use(
      http.get(`${UNKEYED_URL}/:id`, () =>
        HttpResponse.json({ meta: { type: 'entity', entity: 'Unkeyed' }, data: { id: 'u-1' } }),
      ),
    );

    await Effect.runPromise(
      buildEntityRestAdapterGet(Unkeyed, restOptions)('u-1').pipe(
        Effect.provide(configuration),
      ),
    );

    expect(requests).toContainEqual({ method: 'GET', url: `${UNKEYED_URL}/u-1` });
  });

  it('routes a delete through the class name', async () => {
    const requests = recordRequests();

    await Effect.runPromise(
      buildEntityRestAdapterDelete(Unkeyed, restOptions)('u-1').pipe(
        Effect.provide(configuration),
      ),
    );

    expect(requests).toContainEqual({ method: 'DELETE', url: `${UNKEYED_URL}/u-1` });
  });

  it('routes a save through the class name', async () => {
    const requests = recordRequests();
    const unkeyed = new Unkeyed();

    await Effect.runPromise(
      buildEntityRestAdapterSave(Unkeyed, restOptions)(unkeyed).pipe(
        Effect.provide(configuration),
      ),
    );

    expect(requests).toContainEqual({ method: 'POST', url: UNKEYED_URL });
  });
});

describe('the URI configuration group', () => {
  // The group defaults to `restUri`, which is the key services publish under —
  // an adapter configured without one must still find its base URL.
  it('defaults to restUri when none is declared', async () => {
    const requests = recordRequests();
    const defaultGroupConfiguration = stubUriConfigurationLayer(
      { widget: BASE_URL },
      { keyTemplate: 'service-domain.[entity]' },
    );

    await Effect.runPromise(
      buildEntityRestAdapterLoad(Widget, {
        uriConfig: { key: 'service-domain.[entity]' },
      })({}).pipe(Effect.provide(defaultGroupConfiguration)),
    );

    expect(requests).toContainEqual({ method: 'GET', url: BASE_URL });
  });

  it('fails when the configured key is absent', async () => {
    const emptyConfiguration = stubUriConfigurationLayer(
      {},
      { keyTemplate: 'service-domain.[entity]', group: 'uri' },
    );

    await expect(
      Effect.runPromise(
        buildEntityRestAdapterLoad(Widget, restOptions)({}).pipe(
          Effect.provide(emptyConfiguration),
        ),
      ),
    ).rejects.toThrow(/not found/);
  });
});
