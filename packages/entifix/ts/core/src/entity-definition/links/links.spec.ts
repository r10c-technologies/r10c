import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixConnError } from '../../base-entities/entifix-error/index.js';
import type { Entity, EntityConstructor, EntityId } from '../../types/Entity.js';
import { EntityCollectionLink } from './entity-collection-link/index.js';
import { EntityLink, type EntityLinkResolver } from './entity-link/index.js';

class Brand implements Entity {
  constructor(
    public id: EntityId = undefined,
    public name = '',
  ) {}
}

/**
 * A recording resolver: what matters about resolution is not only the value but
 * *how often* the link went back to the source, which is the difference between
 * `resolve` and `reload`.
 */
const makeResolver = (values: Brand[] = []) => {
  const calls: EntityId[] = [];
  const resolver: EntityLinkResolver = {
    resolve<TEntity extends Entity>(
      _entityConstructor: EntityConstructor<TEntity>,
      id: EntityId,
    ) {
      calls.push(id);
      const found = values.find((value) => value.id === id);
      return found === undefined
        ? Effect.fail(new EntifixConnError(`No brand ${String(id)}`))
        : (Effect.succeed(found) as unknown as Effect.Effect<
            TEntity,
            EntifixConnError
          >);
    },
  };
  return { resolver, calls };
};

describe('EntityLink', () => {
  it('starts empty when nothing was supplied', () => {
    const link = new EntityLink(Brand);

    expect(link.id).toBeUndefined();
    expect(link.value).toBeUndefined();
    expect(link.isLoaded).toBe(false);
    expect(link.entityConstructor).toBe(Brand);
  });

  it('holds a foreign key when only the id arrived', () => {
    const link = new EntityLink(Brand, { id: 'b-1' });

    expect(link.id).toBe('b-1');
    expect(link.isLoaded).toBe(false);
  });

  it('is loaded when the target arrived embedded, deriving the id from it', () => {
    const link = new EntityLink(Brand, { value: new Brand('b-1', 'Acme') });

    expect(link.id).toBe('b-1');
    expect(link.isLoaded).toBe(true);
  });

  // An embedded payload may disagree with the id the parent carried; the
  // explicit id wins, because that is what the parent document actually says.
  it('keeps an explicit id over the embedded value’s own', () => {
    const link = new EntityLink(Brand, {
      id: 'b-explicit',
      value: new Brand('b-embedded', 'Acme'),
    });

    expect(link.id).toBe('b-explicit');
  });

  it('falls back to the value’s id when the stored id is absent', () => {
    const link = new EntityLink(Brand);
    link.setValue(new Brand(undefined, 'Acme'));

    expect(link.id).toBeUndefined();
  });

  it('records a foreign key through setId', () => {
    const link = new EntityLink(Brand);
    link.setId('b-2');

    expect(link.id).toBe('b-2');
    expect(link.isLoaded).toBe(false);
  });

  it('keeps the id in sync when a value is stored', () => {
    const link = new EntityLink(Brand, { id: 'b-1' });
    link.setValue(new Brand('b-2', 'Other'));

    expect(link.id).toBe('b-2');
    expect(link.isLoaded).toBe(true);
  });

  it('leaves the id alone when the stored value has none', () => {
    const link = new EntityLink(Brand, { id: 'b-1' });
    link.setValue(new Brand(undefined, 'Nameless'));

    expect(link.id).toBe('b-1');
  });

  it('clears the value through setValue(undefined)', () => {
    const link = new EntityLink(Brand, { value: new Brand('b-1', 'Acme') });
    link.setValue(undefined);

    expect(link.isLoaded).toBe(false);
    expect(link.id).toBe('b-1');
  });

  describe('resolution', () => {
    it('fetches and caches on reload', async () => {
      const { resolver, calls } = makeResolver([new Brand('b-1', 'Acme')]);
      const link = new EntityLink(Brand, { id: 'b-1' });

      const value = await Effect.runPromise(link.reload(resolver));

      expect(value.name).toBe('Acme');
      expect(link.isLoaded).toBe(true);
      expect(calls).toEqual(['b-1']);
    });

    it('refetches on every reload even when already loaded', async () => {
      const { resolver, calls } = makeResolver([new Brand('b-1', 'Acme')]);
      const link = new EntityLink(Brand, { value: new Brand('b-1', 'Stale') });

      await Effect.runPromise(link.reload(resolver));

      expect(calls).toEqual(['b-1']);
      expect(link.value?.name).toBe('Acme');
    });

    it('resolve serves the cached target without touching the resolver', async () => {
      const { resolver, calls } = makeResolver();
      const link = new EntityLink(Brand, { value: new Brand('b-1', 'Acme') });

      expect((await Effect.runPromise(link.resolve(resolver))).name).toBe('Acme');
      expect(calls).toEqual([]);
    });

    it('resolve fetches once when not yet loaded', async () => {
      const { resolver, calls } = makeResolver([new Brand('b-1', 'Acme')]);
      const link = new EntityLink(Brand, { id: 'b-1' });

      await Effect.runPromise(link.resolve(resolver));
      await Effect.runPromise(link.resolve(resolver));

      expect(calls).toEqual(['b-1']);
    });

    it('propagates a resolver failure and leaves the link unloaded', async () => {
      const { resolver } = makeResolver();
      const link = new EntityLink(Brand, { id: 'missing' });

      const exit = await Effect.runPromiseExit(link.resolve(resolver));

      expect(Exit.isFailure(exit)).toBe(true);
      expect(link.isLoaded).toBe(false);
    });
  });
});

describe('EntityCollectionLink', () => {
  it('starts with no ids and no values', () => {
    const link = new EntityCollectionLink(Brand);

    expect(link.ids).toEqual([]);
    expect(link.values).toBeUndefined();
    expect(link.isLoaded).toBe(false);
  });

  it('holds foreign keys when only ids arrived', () => {
    const link = new EntityCollectionLink(Brand, { ids: ['b-1', 'b-2'] });

    expect(link.ids).toEqual(['b-1', 'b-2']);
    expect(link.isLoaded).toBe(false);
  });

  it('derives ids from embedded values, dropping the id-less ones', () => {
    const link = new EntityCollectionLink(Brand, {
      values: [new Brand('b-1', 'Acme'), new Brand(undefined, 'Nameless')],
    });

    expect(link.ids).toEqual(['b-1']);
    expect(link.isLoaded).toBe(true);
  });

  it('keeps explicit ids over the ones derivable from values', () => {
    const link = new EntityCollectionLink(Brand, {
      ids: ['b-explicit'],
      values: [new Brand('b-embedded', 'Acme')],
    });

    expect(link.ids).toEqual(['b-explicit']);
  });

  it('replaces the ids through setIds', () => {
    const link = new EntityCollectionLink(Brand, { ids: ['b-1'] });
    link.setIds(['b-2', 'b-3']);

    expect(link.ids).toEqual(['b-2', 'b-3']);
  });

  it('re-derives the ids when values are stored', () => {
    const link = new EntityCollectionLink(Brand, { ids: ['b-1'] });
    link.setValues([new Brand('b-9', 'Nine'), new Brand(undefined, 'Nameless')]);

    expect(link.ids).toEqual(['b-9']);
    expect(link.isLoaded).toBe(true);
  });

  it('leaves the ids alone when the values are cleared', () => {
    const link = new EntityCollectionLink(Brand, { ids: ['b-1'] });
    link.setValues(undefined);

    expect(link.ids).toEqual(['b-1']);
    expect(link.isLoaded).toBe(false);
  });

  it('reloads every referenced target and caches them', async () => {
    const { resolver, calls } = makeResolver([
      new Brand('b-1', 'Acme'),
      new Brand('b-2', 'Beta'),
    ]);
    const link = new EntityCollectionLink(Brand, { ids: ['b-1', 'b-2'] });

    const values = await Effect.runPromise(link.reload(resolver));

    expect(values.map((value) => value.name)).toEqual(['Acme', 'Beta']);
    expect(calls).toHaveLength(2);
    expect(link.isLoaded).toBe(true);
  });

  it('reloads to an empty list when there are no ids', async () => {
    const { resolver, calls } = makeResolver();
    const link = new EntityCollectionLink(Brand);

    expect(await Effect.runPromise(link.reload(resolver))).toEqual([]);
    expect(calls).toEqual([]);
    expect(link.isLoaded).toBe(true);
  });

  it('resolve serves cached values without touching the resolver', async () => {
    const { resolver, calls } = makeResolver();
    const link = new EntityCollectionLink(Brand, {
      values: [new Brand('b-1', 'Acme')],
    });

    expect(await Effect.runPromise(link.resolve(resolver))).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('resolve fetches once when not yet loaded', async () => {
    const { resolver, calls } = makeResolver([new Brand('b-1', 'Acme')]);
    const link = new EntityCollectionLink(Brand, { ids: ['b-1'] });

    await Effect.runPromise(link.resolve(resolver));
    await Effect.runPromise(link.resolve(resolver));

    expect(calls).toEqual(['b-1']);
  });

  // One unresolvable member fails the whole collection: a half-populated
  // relation is worse than an explicit failure.
  it('fails the whole reload when one target cannot be resolved', async () => {
    const { resolver } = makeResolver([new Brand('b-1', 'Acme')]);
    const link = new EntityCollectionLink(Brand, { ids: ['b-1', 'missing'] });

    const exit = await Effect.runPromiseExit(link.reload(resolver));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(link.isLoaded).toBe(false);
  });
});
