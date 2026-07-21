import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { setupEntifixServer } from '@r10c/entifix-ts-testing-unit/http';

import { configurationHandler, entityBackendHandlers } from './entity-handlers';

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const BASE_URL = 'http://service.test/api/widget';

const { handlers, backend } = entityBackendHandlers(Widget, {
  baseUrl: BASE_URL,
  seed: [
    { id: 'w1', name: 'Acme 1' },
    { id: 'w2', name: 'Globex 1' },
  ],
});

setupEntifixServer(
  ...handlers,
  configurationHandler('http://app.test/api/config', {
    uri: [{ key: 'widget-service-domain', value: 'http://service.test/api' }],
  }),
);

describe('entityBackendHandlers', () => {
  it('serves the collection over the wire', async () => {
    const response = await fetch(`${BASE_URL}?rsql=name%3Dlike%3DAcme`);
    const body = (await response.json()) as {
      data: { items: Array<{ name: string }>; total: number };
    };

    expect(response.status).toBe(200);
    expect(body.data.items.map(item => item.name)).toEqual(['Acme 1']);
  });

  it('carries the backend status through, so 400s are testable in the browser', async () => {
    const response = await fetch(`${BASE_URL}?rsql=nope%3D%3D1`);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid query' });
  });

  it('serves a single record by id', async () => {
    const response = await fetch(`${BASE_URL}/w2`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { name: 'Globex 1' } });
  });

  it('returns the backend so a spec can reseed it', async () => {
    backend.seed([{ id: 'w3', name: 'Wonka' }]);

    const response = await fetch(BASE_URL);
    const body = (await response.json()) as {
      data: { items: Array<{ name: string }> };
    };

    expect(body.data.items.map(item => item.name)).toEqual(['Wonka']);
  });
});

describe('configurationHandler', () => {
  // Without this hop the entity adapters never learn their base URL, and a
  // suite that stubs only the entity endpoint hangs.
  it('answers the configuration lookup a frontend makes first', async () => {
    const response = await fetch('http://app.test/api/config');

    expect(await response.json()).toEqual({
      uri: [{ key: 'widget-service-domain', value: 'http://service.test/api' }],
    });
  });
});
