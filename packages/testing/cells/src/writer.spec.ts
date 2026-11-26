import { EntityRepositoryTag } from '@entifix/business';
import { accessor, type Entity, entity, type EntityId } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context, Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { inMemoryEntity } from './writer.js';

@entity({ domain: 'testing', key: 'thing' })
class Thing implements Entity {
  #id?: EntityId;
  #name = '';
  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
  @accessor({ type: 'string' })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }
}

const thing = (id: string, name: string) =>
  Object.assign(new Thing(), { id, name });

describe('inMemoryEntity', () => {
  it('saves through the writer and reads it back from the same repository', async () => {
    const { rest, writer } = inMemoryEntity([thing('t-1', 'uno')]);
    const saved = await Effect.runPromise(writer.save(thing('t-2', 'dos')));
    expect(saved).toMatchObject({ _tag: 'settled' });

    const repository = Context.get(rest, EntityRepositoryTag);
    const page = await Effect.runPromise(repository.load({}));
    expect(page.items.map(one => String(one.id)).sort()).toEqual([
      't-1',
      't-2',
    ]);
  });

  it('deletes through the writer and settles with nothing', async () => {
    const { rest, writer } = inMemoryEntity([thing('t-1', 'uno')]);
    const outcome = await Effect.runPromise(writer.delete('t-1'));
    expect(outcome).toMatchObject({ _tag: 'settled' });

    const repository = Context.get(rest, EntityRepositoryTag);
    const page = await Effect.runPromise(repository.load({}));
    expect(page.items).toEqual([]);
  });

  it('starts empty when handed nothing', async () => {
    const { rest } = inMemoryEntity();
    const page = await Effect.runPromise(
      Context.get(rest, EntityRepositoryTag).load({}),
    );
    expect(page.items).toEqual([]);
  });

  it('wraps a repository the spec already holds', async () => {
    const repository = makeInMemoryEntityRepository([thing('t-1', 'uno')]);
    const { writer } = inMemoryEntity(repository);
    await Effect.runPromise(writer.save(thing('t-2', 'dos')));
    const page = await Effect.runPromise(repository.load({}));
    expect(page.items).toHaveLength(2);
  });
});
