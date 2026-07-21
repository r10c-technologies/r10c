import type {
  ConfigurationStore,
  Entity,
  EntityId,
  EntityLoadRequest,
  EntityPage,
} from '@r10c/entifix-ts-core';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConfigurationRepositoryTag } from '../repository/config.repository.js';
import type { EntityRepository } from '../repository/entity.repository.js';
import { EntityRepositoryTag } from '../repository/entity.repository.js';
import {
  EntityIdTag,
  EntityLoadRequestTag,
  EntityTag,
} from '../repository/entity-mixins.repository.js';
import { getUCFactory } from './get/index.js';
import { loadUCFactory } from './load/index.js';

interface Widget extends Entity {
  name: string;
}

const aPage = (items: Widget[]): EntityPage<Widget> => ({
  items,
  total: items.length,
  request: {},
});

/**
 * A hand-rolled repository double. This package defines the very interfaces
 * `@r10c/entifix-ts-testing-unit` is built on, so depending on that package
 * here would be a cycle — the doubles stay local by design.
 */
function makeRepositoryDouble(options: {
  page?: EntityPage<Widget>;
  entity?: Widget;
  failWith?: EntifixConnError;
}) {
  const calls = {
    loaded: [] as EntityLoadRequest[],
    got: [] as EntityId[],
  };
  const repository = {
    load: (request: EntityLoadRequest) => {
      calls.loaded.push(request);
      return options.failWith
        ? Effect.fail(options.failWith)
        : Effect.succeed(options.page ?? aPage([]));
    },
    get: (id: EntityId) => {
      calls.got.push(id);
      return options.failWith
        ? Effect.fail(options.failWith)
        : Effect.succeed(options.entity);
    },
  } as unknown as EntityRepository;

  return { repository, calls };
}

/**
 * The repository contract leaves `ConfigurationRepositoryTag` on every method's
 * requirement channel (real adapters read their base URL from it), so the
 * use-cases inherit it and it must be discharged here. The doubles never read
 * it.
 */
const testContext = (repository: EntityRepository) =>
  Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(ConfigurationRepositoryTag, {} as ConfigurationStore),
  );

describe('loadUCFactory', () => {
  it('passes the request from EntityLoadRequestTag straight through', () => {
    // EntityLoadRequestTag is not generic, so the request goes in untyped and
    // the factory's parameter is what makes the result usable.
    const request: EntityLoadRequest = { page: 2, pageSize: 5 };
    const { repository, calls } = makeRepositoryDouble({});

    Effect.runSync(
      loadUCFactory<Widget>().pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityLoadRequestTag, request)),
        ),
      ),
    );

    expect(calls.loaded).toEqual([request]);
  });

  it('returns the repository page verbatim', () => {
    const page = aPage([{ id: 'w-1', name: 'Sprocket' }]);
    const { repository } = makeRepositoryDouble({ page });

    const result = Effect.runSync(
      loadUCFactory<Widget>().pipe(
        Effect.provide(
          testContext(repository).pipe(Context.add(EntityLoadRequestTag, {})),
        ),
      ),
    );

    expect(result).toBe(page);
  });

  // The use-case adds no error handling of its own: a transport failure has to
  // reach the caller with its type intact so the shell can distinguish it from
  // a build error.
  it('propagates a repository failure untouched', () => {
    const failure = new EntifixConnError('unreachable');
    const { repository } = makeRepositoryDouble({ failWith: failure });

    const error = Effect.runSync(
      Effect.flip(
        loadUCFactory<Widget>().pipe(
          Effect.provide(
            testContext(repository).pipe(Context.add(EntityLoadRequestTag, {})),
          ),
        ),
      ),
    );

    expect(error).toBe(failure);
  });
});

describe('getUCFactory', () => {
  it('passes the id from EntityIdTag to the repository', () => {
    const { repository, calls } = makeRepositoryDouble({});

    Effect.runSync(
      getUCFactory<Widget>().pipe(
        Effect.provide(testContext(repository).pipe(Context.add(EntityIdTag, 'w-1'))),
      ),
    );

    expect(calls.got).toEqual(['w-1']);
  });

  it('returns the entity the repository found', () => {
    const widget: Widget = { id: 'w-1', name: 'Sprocket' };
    const { repository } = makeRepositoryDouble({ entity: widget });

    const result = Effect.runSync(
      getUCFactory<Widget>().pipe(
        Effect.provide(testContext(repository).pipe(Context.add(EntityIdTag, 'w-1'))),
      ),
    );

    expect(result).toBe(widget);
  });

  it('propagates a repository failure untouched', () => {
    const failure = new EntifixConnError('unreachable');
    const { repository } = makeRepositoryDouble({ failWith: failure });

    const error = Effect.runSync(
      Effect.flip(
        getUCFactory<Widget>().pipe(
          Effect.provide(testContext(repository).pipe(Context.add(EntityIdTag, 'w-1'))),
        ),
      ),
    );

    expect(error).toBe(failure);
  });
});

// The tags are the DI seam: a duplicated identifier would silently make two
// distinct dependencies resolve to the same value.
describe('context tags', () => {
  it('carry distinct identifiers', () => {
    const identifiers = [
      EntityRepositoryTag,
      EntityIdTag,
      EntityLoadRequestTag,
      EntityTag,
      ConfigurationRepositoryTag,
    ].map((tag) => tag.key);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });
});
