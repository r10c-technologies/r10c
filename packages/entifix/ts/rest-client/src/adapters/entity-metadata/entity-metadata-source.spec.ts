import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  makeEntityMetadataEnvelope,
} from '@r10c/entifix-ts-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEntityMetadataSource } from './make-entity-metadata-source/index.js';

@entity({ domain: 'authn', key: 'user-identity' })
class UserIdentity implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const source = makeEntityMetadataSource({
  url: (name: string) => `/api/${name}/$metadata`,
});

const respondWith = (body: unknown, init: ResponseInit = { status: 200 }) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), init)),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeEntityMetadataSource', () => {
  it('addresses the entity by its envelope name and returns the document', async () => {
    const document = { actions: ['read' as const], useCases: [] };
    respondWith(makeEntityMetadataEnvelope(UserIdentity, document));

    const read = await source.fetchMetadata(UserIdentity);

    expect(read).toEqual(document);
    expect(fetch).toHaveBeenCalledWith('/api/user-identity/$metadata', {
      headers: { Accept: 'application/json' },
    });
  });

  it('fails on a 404 rather than reporting an empty affordance set', async () => {
    respondWith({ code: 'notFound' }, { status: 404 });

    await expect(source.fetchMetadata(UserIdentity)).rejects.toThrow(
      /status 404/,
    );
  });

  it('fails when the transport does', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    await expect(source.fetchMetadata(UserIdentity)).rejects.toThrow(
      /Metadata request/,
    );
  });

  it('fails when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );

    await expect(source.fetchMetadata(UserIdentity)).rejects.toThrow(
      /not JSON/,
    );
  });

  it('fails when the envelope is of another type', async () => {
    respondWith({
      meta: { type: 'entity', entity: 'user-identity' },
      data: {},
    });

    await expect(source.fetchMetadata(UserIdentity)).rejects.toThrow(
      /entityMetadata/,
    );
  });
});
