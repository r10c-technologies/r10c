import {
  accessor,
  ConfigurationClientInMemory,
  EntifixConnError,
  EntifixLogicError,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { ConfigurationRepositoryTag } from './config.repository.js';
import { EntityRepositoryTag } from './entity.repository.js';
import {
  createEntityLinkResolver,
  type EntityLinkRegistration,
  EntityLinkResolverTag,
} from './entity-link-resolver.repository.js';

@entity({ key: 'brand' })
class Brand implements Entity {
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

@entity({ key: 'category' })
class Category implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const makeBrand = (id: string, name: string) => {
  const brand = new Brand();
  brand.id = id;
  brand.name = name;
  return brand;
};

const configuration = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientInMemory({}),
);

/**
 * A hand-rolled double rather than `makeInMemoryEntityRepository` from
 * `@r10c/entifix-ts-testing-unit`: that package depends on **this** one for its
 * tags, so dev-depending on it back would make the two projects a cycle in the
 * task graph. Only `get` is exercised here anyway — a link resolver never loads
 * a page.
 */
const repositoryFor = (items: Entity[]) =>
  Context.make(EntityRepositoryTag, {
    get: (id: EntityId) => {
      const found = items.find(item => item.id === id);
      return found
        ? Effect.succeed(found)
        : Effect.fail(new EntifixConnError(`No entity with id "${String(id)}"`));
    },
    load: () => Effect.fail(new EntifixLogicError('not used')),
    save: () => Effect.fail(new EntifixLogicError('not used')),
    delete: () => Effect.fail(new EntifixLogicError('not used')),
  } as unknown as EntityRepositoryTag['Type']);

const registrations = (): EntityLinkRegistration[] => [
  [Brand, repositoryFor([makeBrand('b-1', 'Acme')])],
  [Category, repositoryFor([])],
];

const resolve = (
  context: Context.Context<EntityLinkResolverTag>,
  entityConstructor: new () => Entity,
  id: EntityId,
) =>
  Effect.runPromiseExit(
    Context.get(context, EntityLinkResolverTag).resolve(entityConstructor, id),
  );

describe('createEntityLinkResolver', () => {
  // Each registration's `get` is closed over the configuration context here, so
  // the resolver's effects have no outstanding requirements — which is what
  // lets a core `EntityLink` run them without knowing about Effect tags.
  it('discharges the configuration requirement so the resolver needs nothing', async () => {
    const exit = await resolve(
      createEntityLinkResolver(configuration, registrations()),
      Brand,
      'b-1',
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isSuccess(exit) && (exit.value as Brand).name).toBe('Acme');
  });

  it('routes each target to its own repository', async () => {
    const context = createEntityLinkResolver(configuration, registrations());

    expect(Exit.isFailure(await resolve(context, Category, 'b-1'))).toBe(true);
  });

  it('rejects an unregistered target as a logic error', async () => {
    const exit = await resolve(
      createEntityLinkResolver(configuration, [
        [Brand, repositoryFor([makeBrand('b-1', 'Acme')])],
      ]),
      Category,
      'c-1',
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error =
      Exit.isFailure(exit) && exit.cause._tag === 'Fail'
        ? exit.cause.error
        : undefined;
    expect(error).toBeInstanceOf(EntifixLogicError);
    expect((error as EntifixLogicError).message).toContain('Category');
  });

  it('propagates a not-found from the underlying repository', async () => {
    const exit = await resolve(
      createEntityLinkResolver(configuration, registrations()),
      Brand,
      'missing',
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('registers nothing when handed an empty list', async () => {
    const exit = await resolve(
      createEntityLinkResolver(configuration, []),
      Brand,
      'b-1',
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
