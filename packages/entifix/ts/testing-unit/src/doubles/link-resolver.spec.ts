import {
  accessor,
  EntifixConnError,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeInMemoryEntityLinkResolver } from './link-resolver';

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

const resolver = () =>
  makeInMemoryEntityLinkResolver([
    [Brand, [makeBrand('b-1', 'Acme')]],
    [Category, []],
  ]);

describe('makeInMemoryEntityLinkResolver', () => {
  it('resolves a registered target by id', async () => {
    const found = await Effect.runPromise(resolver().resolve(Brand, 'b-1'));

    expect((found as Brand).name).toBe('Acme');
  });

  it('keeps each constructor’s table separate', async () => {
    const exit = await Effect.runPromiseExit(resolver().resolve(Category, 'b-1'));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('fails for an id the table does not hold', async () => {
    const exit = await Effect.runPromiseExit(resolver().resolve(Brand, 'missing'));

    expect(Exit.isFailure(exit)).toBe(true);
    const error =
      Exit.isFailure(exit) && exit.cause._tag === 'Fail' ? exit.cause.error : undefined;
    expect(error).toBeInstanceOf(EntifixConnError);
    expect((error as EntifixConnError).details).toEqual({
      entity: 'Brand',
      id: 'missing',
    });
  });

  it('fails for a constructor that was never registered', async () => {
    const bare = makeInMemoryEntityLinkResolver([]);

    expect(Exit.isFailure(await Effect.runPromiseExit(bare.resolve(Brand, 'b-1')))).toBe(
      true,
    );
  });

  // `requested` is what shows whether an already-embedded link was needlessly
  // refetched — the distinction a link-following use-case turns on.
  it('records every request in order, including the failed ones', async () => {
    const links = resolver();

    await Effect.runPromiseExit(links.resolve(Brand, 'b-1'));
    await Effect.runPromiseExit(links.resolve(Brand, 'missing'));

    expect(links.requested).toEqual([
      { entity: 'Brand', id: 'b-1' },
      { entity: 'Brand', id: 'missing' },
    ]);
  });

  // The effect is suspended, so nothing is recorded until it actually runs.
  it('records nothing until the effect is run', () => {
    const links = resolver();

    links.resolve(Brand, 'b-1');

    expect(links.requested).toEqual([]);
  });
});
