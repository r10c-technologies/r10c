import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { renderHook } from '@testing-library/react';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type EntityLinkRegistration,
  useEntityLinkResolver,
} from './use-entity-link-resolver.js';

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
  makeStubConfigurationStore(),
);

const repositoryFor = (items: Entity[]) =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository(items));

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

describe('useEntityLinkResolver', () => {
  // Pages build the registration array inline, so it is a new literal every
  // render. Memoizing on its identity would rebuild every repository on every
  // render — the memo is keyed on the registered names instead.
  it('keeps the same context across renders of the same registrations', () => {
    const { result, rerender } = renderHook(() =>
      useEntityLinkResolver(configuration, registrations()),
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('rebuilds when the registered targets change', () => {
    const { result, rerender } = renderHook(
      ({ list }: { list: EntityLinkRegistration[] }) =>
        useEntityLinkResolver(configuration, list),
      { initialProps: { list: [registrations()[0] as EntityLinkRegistration] } },
    );
    const first = result.current;

    rerender({ list: registrations() });

    expect(result.current).not.toBe(first);
  });

  it('resolves through the memoized context', async () => {
    const { result } = renderHook(() =>
      useEntityLinkResolver(configuration, registrations()),
    );

    const exit = await resolve(result.current, Brand, 'b-1');

    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
