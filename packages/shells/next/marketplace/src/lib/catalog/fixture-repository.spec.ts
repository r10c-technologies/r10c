import { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { EntityLoadRequest, SerializedEntity } from '@r10c/entifix-ts-core';
import { Context, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  createFixtureRepositoryContext,
  fixtureConfigurationContext,
} from './fixture-repository';

const ROWS: SerializedEntity[] = [
  { id: 'c-1', code: 'lighting', name: 'Lighting' },
  { id: 'c-2', code: 'tableware', name: 'Tableware' },
  { id: 'c-3', code: 'textiles', name: 'Textiles' },
  // Shares a name with `c-1` so the comparator has to fall through every clause
  // and return "equal" — the branch a set of distinct rows never reaches.
  { id: 'c-4', code: 'lamps', name: 'Lighting' },
];

const repository = Context.get(
  createFixtureRepositoryContext(ProductCategory, ROWS),
  EntityRepositoryTag,
);

function run<A, E>(effect: Effect.Effect<A, E, never>) {
  return Effect.runPromise(effect);
}

function load(request: EntityLoadRequest<ProductCategory> = {}) {
  return run(
    Effect.provide(
      repository.load<ProductCategory>(request),
      fixtureConfigurationContext,
    ),
  );
}

describe('the fixture repository', () => {
  it('deserializes rows into entity instances', async () => {
    const page = await load();

    expect(page.total).toBe(4);
    expect(page.items[0]).toBeInstanceOf(ProductCategory);
    expect(page.items.map(item => item.code)).toEqual([
      'lighting',
      'tableware',
      'textiles',
      'lamps',
    ]);
  });

  it('filters on equality', async () => {
    const page = await load({
      filtering: [
        { property: 'code', operator: 'eq', value: 'tableware' },
      ] as never,
    });

    expect(page.items.map(item => item.code)).toEqual(['tableware']);
    expect(page.total).toBe(1);
  });

  it('matches `like` case-insensitively on a substring', async () => {
    const page = await load({
      filtering: [{ property: 'name', operator: 'like', value: 'TEX' }] as never,
    });

    expect(page.items.map(item => item.code)).toEqual(['textiles']);
  });

  it('matches any of the values for `in`', async () => {
    const page = await load({
      filtering: [
        { property: 'code', operator: 'in', values: ['lighting', 'textiles'] },
      ] as never,
    });

    expect(page.items.map(item => item.code)).toEqual(['lighting', 'textiles']);
  });

  it('sorts, descending when asked', async () => {
    const page = await load({
      sorting: [{ 0: { property: 'name', type: 'desc' } }] as never,
    });

    expect(page.items.map(item => item.name)).toEqual([
      'Textiles',
      'Tableware',
      'Lighting',
      'Lighting',
    ]);
  });

  // Two rows that compare equal on every clause must keep their relative order
  // rather than the comparator falling off the end with an undefined result.
  it('leaves equal rows in their original order', async () => {
    const page = await load({
      sorting: [{ 0: { property: 'name', type: 'asc' } }] as never,
    });

    expect(page.items.map(item => item.code)).toEqual([
      'lighting',
      'lamps',
      'tableware',
      'textiles',
    ]);
  });

  /**
   * Not every column is populated — `description` is optional on the entity, and
   * these rows omit it. A missing value has to read as empty rather than as the
   * string `"undefined"`, which would both match a `like` for "undefined" and
   * sort into the middle of the alphabet.
   */
  it('treats a missing field as empty when matching', async () => {
    const page = await load({
      filtering: [
        { property: 'description', operator: 'like', value: 'undefined' },
      ] as never,
    });

    expect(page.items).toEqual([]);
  });

  it('treats a missing field as empty when sorting', async () => {
    const page = await load({
      sorting: [{ 0: { property: 'description', type: 'asc' } }] as never,
    });

    expect(page.items.map(item => item.code)).toEqual([
      'lighting',
      'tableware',
      'textiles',
      'lamps',
    ]);
  });

  it('pages from 1, and reports the unpaged total', async () => {
    const page = await load({ page: 2, pageSize: 2 });

    expect(page.items.map(item => item.code)).toEqual(['textiles', 'lamps']);
    expect(page.total).toBe(4);
  });

  /**
   * The behaviour that matters most. A fixture repository that ignored a filter
   * it did not understand would answer with the whole catalog and look like a
   * working page — while the real service answers `400`. Failing here is what
   * keeps the two honest with each other.
   */
  it('refuses an operator it does not implement rather than matching everything', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        repository.load<ProductCategory>({
          filtering: [{ property: 'name', operator: 'isNull' }] as never,
        }),
        fixtureConfigurationContext,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('refuses a filter group', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        repository.load<ProductCategory>({
          filtering: [
            { operator: 'or', values: [] },
          ] as never,
        }),
        fixtureConfigurationContext,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('gets one row by id', async () => {
    const found = await run(
      Effect.provide(
        repository.get<ProductCategory>('c-2'),
        fixtureConfigurationContext,
      ),
    );

    expect(found.code).toBe('tableware');
  });

  it('fails on an unknown id instead of returning undefined', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.provide(
        repository.get<ProductCategory>('nope'),
        fixtureConfigurationContext,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  // Read-only this iteration, and a stub that silently succeeded would let a
  // write path get built against a repository that never stored anything.
  it('rejects writes', async () => {
    const saved = await Effect.runPromiseExit(
      Effect.provide(
        repository.save(new ProductCategory('x', 'X')),
        fixtureConfigurationContext,
      ),
    );
    const deleted = await Effect.runPromiseExit(
      Effect.provide(repository.delete('c-1'), fixtureConfigurationContext),
    );

    expect(Exit.isFailure(saved)).toBe(true);
    expect(Exit.isFailure(deleted)).toBe(true);
  });
});
