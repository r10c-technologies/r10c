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
  respondWith500,
  respondWithMalformedEnvelope,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BuildEntityRestOptions } from '../types.js';
import { buildEntityRestAdapterSave } from './build-entity-rest-adapter-save.js';

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

const BASE_URL = 'http://service/api/widget';

const restOptions: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
};

const configuration = stubUriConfigurationLayer(
  { widget: BASE_URL },
  { keyTemplate: 'service-domain.[entity]', group: 'uri' },
);

// Every request goes through MSW, so what is asserted is the wire: the method,
// the URL, and the envelope — not that some function was handed an object.
const server = setupEntifixServer(
  ...entityRestHandlers(Widget, { baseUrl: BASE_URL }),
);

const makeWidget = (id: EntityId, name: string): Widget => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  return widget;
};

const recordRequests = () => {
  const requests: Array<{ method: string; url: string }> = [];
  server.events.on('request:start', ({ request }) => {
    requests.push({ method: request.method, url: request.url });
  });
  return requests;
};

const runSave = (widget: Widget) =>
  Effect.runPromise(
    buildEntityRestAdapterSave(
      Widget,
      restOptions,
    )(widget).pipe(Effect.provide(configuration)),
  );

/** The same adapter, opted into the transactional (CQRS) create path. */
const commandOptions: BuildEntityRestOptions = {
  ...restOptions,
  create: 'command',
};

const runCommandSave = (widget: Widget) =>
  Effect.runPromise(
    buildEntityRestAdapterSave(
      Widget,
      commandOptions,
    )(widget).pipe(Effect.provide(configuration)),
  );

/** What marketplace-admin-service answers a command with. */
const acceptedTransaction = (transactionId: string) =>
  HttpResponse.json(
    {
      meta: {
        type: 'transactionEvent',
        entity: 'widget',
        links: [
          {
            rel: 'status',
            href: `/api/transaction/${transactionId}`,
            method: 'GET',
          },
        ],
      },
      data: { transactionId, state: 'PENDING' },
    },
    { status: 202 },
  );

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('buildEntityRestAdapterSave', () => {
  it('POSTs to the collection when the entity has no id', async () => {
    const requests = recordRequests();

    await runSave(makeWidget(undefined, 'Sprocket'));

    expect(requests).toContainEqual({ method: 'POST', url: BASE_URL });
  });

  it('PUTs to the entity URL when the entity already has an id', async () => {
    const requests = recordRequests();

    await runSave(makeWidget('widget-1', 'Sprocket'));

    expect(requests).toContainEqual({
      method: 'PUT',
      url: `${BASE_URL}/widget-1`,
    });
  });

  it('sends the entity as an envelope body', async () => {
    let received: unknown;
    server.use(
      http.put(`${BASE_URL}/:id`, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'widget-1', name: 'Sprocket' },
        });
      }),
    );

    await runSave(makeWidget('widget-1', 'Sprocket'));

    expect(received).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: { id: 'widget-1', name: 'Sprocket' },
    });
  });

  it('returns the entity from the response, not the one sent', async () => {
    server.use(
      http.post(BASE_URL, () =>
        HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'generated-1', name: 'Normalized' },
        }),
      ),
    );

    const result = await runSave(makeWidget(undefined, 'Sprocket'));

    // The service is the authority on the stored truth — it minted the id and
    // normalized the name — so that is what callers must render.
    expect(result).toBeInstanceOf(Widget);
    expect(result.id).toBe('generated-1');
    expect(result.name).toBe('Normalized');
  });

  it('fails when the response is not an envelope', async () => {
    server.use(respondWithMalformedEnvelope(`${BASE_URL}/:id`, 'put'));

    await expect(runSave(makeWidget('widget-1', 'Sprocket'))).rejects.toThrow(
      /no meta.type/,
    );
  });

  it('fails when the service answers with an error status', async () => {
    server.use(respondWith500(`${BASE_URL}/:id`, 'put'));

    await expect(runSave(makeWidget('widget-1', 'Sprocket'))).rejects.toThrow();
  });
});

describe('buildEntityRestAdapterSave, transactional create', () => {
  it('POSTs a command envelope carrying a client-minted transaction id', async () => {
    let received: { meta?: unknown; data?: Record<string, unknown> } = {};
    server.use(
      http.post(BASE_URL, async ({ request }) => {
        received = (await request.json()) as typeof received;
        return acceptedTransaction(
          String(received.data?.['transactionId'] ?? ''),
        );
      }),
    );

    await runCommandSave(makeWidget(undefined, 'Sprocket'));

    expect(received.meta).toEqual({ type: 'command', entity: 'widget' });
    expect(received.data).toMatchObject({ type: 'create', entity: 'widget' });
    // The service constrains the key space a caller may address, so an id that
    // is merely unique is not enough — it has to be a UUID.
    expect(String(received.data?.['transactionId'])).toMatch(UUID);
  });

  // The whole point of the client owning the id: the record is addressable
  // immediately, without waiting for a write that has not happened yet.
  it('returns the entity carrying the id the service will store it under', async () => {
    let sent = '';
    server.use(
      http.post(BASE_URL, async ({ request }) => {
        const body = (await request.json()) as {
          data: { transactionId: string };
        };
        sent = body.data.transactionId;
        return acceptedTransaction(sent);
      }),
    );

    const result = await runCommandSave(makeWidget(undefined, 'Sprocket'));

    expect(result.id).toBe(sent);
    expect(result.name).toBe('Sprocket');
  });

  it('serializes the entity into the command payload', async () => {
    let received: { data?: { payload?: unknown } } = {};
    server.use(
      http.post(BASE_URL, async ({ request }) => {
        received = (await request.json()) as typeof received;
        return acceptedTransaction('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
      }),
    );

    await runCommandSave(makeWidget(undefined, 'Sprocket'));

    expect(received.data?.payload).toMatchObject({ name: 'Sprocket' });
  });

  // The defect this path exists to fix ran the other way: a `202` describing a
  // transaction was parsed as an entity envelope, so a create that was about to
  // succeed reported an error. Reading it as what it is must not fail.
  it('accepts the 202 without trying to read it as an entity', async () => {
    server.use(
      http.post(BASE_URL, () =>
        acceptedTransaction('3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
      ),
    );

    await expect(
      runCommandSave(makeWidget(undefined, 'Sprocket')),
    ).resolves.toBeInstanceOf(Widget);
  });

  // A 2xx carrying something other than a transaction means the service is not
  // the one we think it is — which is exactly what the old code could not tell
  // apart from a successful create.
  it('fails when a 2xx does not describe a transaction', async () => {
    server.use(
      http.post(BASE_URL, () =>
        HttpResponse.json(
          {
            meta: { type: 'entity', entity: 'widget' },
            data: { id: 'widget-1', name: 'Sprocket' },
          },
          { status: 202 },
        ),
      ),
    );

    await expect(
      runCommandSave(makeWidget(undefined, 'Sprocket')),
    ).rejects.toThrow(/transactionEvent/);
  });

  // An update is not a command: the record exists, so it is a plain REST write
  // on its own URL regardless of how this entity is created.
  it('still PUTs an existing entity', async () => {
    const requests = recordRequests();

    await runCommandSave(makeWidget('widget-1', 'Sprocket'));

    expect(requests).toContainEqual({
      method: 'PUT',
      url: `${BASE_URL}/widget-1`,
    });
  });
});
