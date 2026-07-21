import { EntityLinkResolverTag } from '@r10c/entifix-ts-business';
import {
  accessor,
  EntifixLogicError,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { makeFakeMongoDb } from '@r10c/entifix-ts-testing-unit/drivers';
import { Context, Effect, Exit } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoLinkResolver } from './make-mongo-link-resolver.js';

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

const withFakeDb = () => {
  const fake = makeFakeMongoDb({
    brand: [{ id: 'b-1', name: 'Acme' }],
    category: [{ id: 'c-1' }],
  });
  return { fake, db: fake.db as Db };
};

const resolve = <TEntity extends Entity>(
  context: Context.Context<EntityLinkResolverTag>,
  entityConstructor: new () => TEntity,
  id: EntityId,
) =>
  Effect.runPromiseExit(
    Context.get(context, EntityLinkResolverTag).resolve(entityConstructor, id),
  );

describe('makeMongoLinkResolver', () => {
  it('fetches a registered target through its Mongo repository', async () => {
    const { db } = withFakeDb();

    const exit = await resolve(
      makeMongoLinkResolver(db, [Brand, Category]),
      Brand,
      'b-1',
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(Exit.isSuccess(exit) && (exit.value as Brand).name).toBe('Acme');
  });

  it('reads each registration from its own collection', async () => {
    const { fake, db } = withFakeDb();

    await resolve(makeMongoLinkResolver(db, [Brand, Category]), Category, 'c-1');

    expect(fake.operations.every((op) => op.collection === 'category')).toBe(true);
  });

  // The registration list is the whole contract of the resolver: an unregistered
  // target is a composition-root mistake, so it fails as a logic error rather
  // than silently querying a collection that may not exist.
  it('rejects an unregistered target as a logic error', async () => {
    const { db } = withFakeDb();

    const exit = await resolve(makeMongoLinkResolver(db, [Brand]), Category, 'c-1');

    expect(Exit.isFailure(exit)).toBe(true);
    const error = Exit.isFailure(exit) && exit.cause._tag === 'Fail' ? exit.cause.error : undefined;
    expect(error).toBeInstanceOf(EntifixLogicError);
    expect((error as EntifixLogicError).message).toContain('Category');
  });

  it('propagates a not-found from the repository', async () => {
    const { db } = withFakeDb();

    const exit = await resolve(makeMongoLinkResolver(db, [Brand]), Brand, 'missing');

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('registers nothing when handed an empty list', async () => {
    const { db } = withFakeDb();

    const exit = await resolve(makeMongoLinkResolver(db, []), Brand, 'b-1');

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
