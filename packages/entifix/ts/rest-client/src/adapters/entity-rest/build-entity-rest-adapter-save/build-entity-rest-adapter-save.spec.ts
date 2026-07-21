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
    buildEntityRestAdapterSave(Widget, restOptions)(widget).pipe(
      Effect.provide(configuration),
    ),
  );

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
