import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  accessor,
  type ConfigurationStore,
  type ConfigurationStoreGroup,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

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

const restOptions: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
};

/** Resolves any key to a fixed base URL — URL composition is tested elsewhere. */
const configurationContext = Context.make(ConfigurationRepositoryTag, {
  in: () =>
    ({
      getString: () => Effect.succeed('http://service/api/widget'),
    }) as unknown as ConfigurationStoreGroup,
} as ConfigurationStore);

function mockFetchReturning(body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function makeWidget(id: EntityId, name: string): Widget {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  return widget;
}

const savedEnvelope = (id: string, name: string) => ({
  meta: { type: 'entity', entity: 'widget' },
  data: { id, name },
});

const runSave = (widget: Widget) =>
  Effect.runPromise(
    buildEntityRestAdapterSave(Widget, restOptions)(widget).pipe(
      Effect.provide(configurationContext),
    ),
  );

describe('buildEntityRestAdapterSave', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs to the collection when the entity has no id', async () => {
    const fetchMock = mockFetchReturning(savedEnvelope('generated-1', 'Sprocket'));

    await runSave(makeWidget(undefined, 'Sprocket'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://service/api/widget');
    expect(init.method).toBe('POST');
  });

  it('PUTs to the entity URL when the entity already has an id', async () => {
    const fetchMock = mockFetchReturning(savedEnvelope('widget-1', 'Sprocket'));

    await runSave(makeWidget('widget-1', 'Sprocket'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://service/api/widget/widget-1');
    expect(init.method).toBe('PUT');
  });

  it('sends the entity as an envelope body', async () => {
    const fetchMock = mockFetchReturning(savedEnvelope('widget-1', 'Sprocket'));

    await runSave(makeWidget('widget-1', 'Sprocket'));

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      meta: { type: 'entity', entity: 'widget' },
      data: { id: 'widget-1', name: 'Sprocket' },
    });
  });

  it('returns the entity from the response, not the one sent', async () => {
    mockFetchReturning(savedEnvelope('generated-1', 'Normalized'));

    const result = await runSave(makeWidget(undefined, 'Sprocket'));

    expect(result).toBeInstanceOf(Widget);
    expect(result.id).toBe('generated-1');
    expect(result.name).toBe('Normalized');
  });

  it('fails when the response is not an envelope', async () => {
    mockFetchReturning({ id: 'widget-1', name: 'Sprocket' });

    await expect(runSave(makeWidget('widget-1', 'Sprocket'))).rejects.toThrow(
      /no meta.type/,
    );
  });
});
