import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import { type Entity, type EntityId } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { ProductBrand } from '../../entities/product-brand/product-brand.entity.js';
import {
  RETIRE_ALREADY,
  RETIRE_NOT_FOUND,
  RetireReferenceInputTag,
  retireReferences,
} from './retire-reference.js';

/** `EntifixError` is abstract, so a double needs a concrete failure of its own. */
class NotFound extends Error {}

const brand = (id: string, status: 'active' | 'retired'): ProductBrand => {
  const one = new ProductBrand(`Brand ${id}`);
  one.id = id;
  one.status = status;
  return one;
};

/**
 * A repository holding the rows by id. `save` records what it was handed, so a
 * test can assert the *write* rather than only the reported outcome — an
 * implementation that reported success and wrote nothing would pass otherwise.
 */
const repositoryOf = (...rows: ProductBrand[]) => {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const saved: ProductBrand[] = [];

  const repository = {
    get: <TEntity extends Entity>(id: EntityId) => {
      const row = byId.get(String(id));
      return row
        ? Effect.succeed(row as unknown as TEntity)
        : Effect.fail(new NotFound('not found'));
    },
    load: vi.fn(),
    save: <TEntity extends Entity>(entity: TEntity) => {
      saved.push(entity as unknown as ProductBrand);
      return Effect.succeed(entity);
    },
    delete: vi.fn(),
  };

  return { repository, saved };
};

const run = (rows: ProductBrand[], ids: EntityId[], retired = true) => {
  const { repository, saved } = repositoryOf(...rows);
  const outcomes = Effect.runSync(
    retireReferences.pipe(
      Effect.provideService(RetireReferenceInputTag, { ids, retired }),
      // The repository's signature threads a configuration requirement it never
      // uses on this path; the cast keeps the double honest about the members
      // that are actually exercised.
      Effect.provideService(
        EntityRepositoryTag,
        repository as unknown as typeof EntityRepositoryTag.Service,
      ),
    ) as Effect.Effect<
      Array<{ id: EntityId; ok: boolean; code?: string }>,
      never,
      never
    >,
  );
  return { outcomes, saved };
};

describe('retireReferences', () => {
  it('retires each row and reports it', () => {
    const { outcomes, saved } = run(
      [brand('1', 'active'), brand('2', 'active')],
      ['1', '2'],
    );

    expect(outcomes).toEqual([
      { id: '1', ok: true },
      { id: '2', ok: true },
    ]);
    expect(saved.map(row => row.status)).toEqual(['retired', 'retired']);
  });

  it('restores when asked the other way', () => {
    const { outcomes, saved } = run([brand('1', 'retired')], ['1'], false);

    expect(outcomes).toEqual([{ id: '1', ok: true }]);
    expect(saved[0]?.status).toBe('active');
  });

  /**
   * The requirement partial reporting exists for. Forty selected, three already
   * retired: a run that reported plain success would leave the operator
   * believing it acted on all forty.
   */
  it('reports a row already in the requested state as its own failure', () => {
    const { outcomes, saved } = run(
      [brand('1', 'active'), brand('2', 'retired'), brand('3', 'active')],
      ['1', '2', '3'],
    );

    expect(outcomes).toEqual([
      { id: '1', ok: true },
      { id: '2', ok: false, code: RETIRE_ALREADY },
      { id: '3', ok: true },
    ]);
    // And it wrote nothing for that row — the failure is not cosmetic.
    expect(saved.map(row => row.id)).toEqual(['1', '3']);
  });

  /**
   * Deliberately not one transaction: these rows share no invariant, so
   * atomicity would only turn a partial success into a total failure. One
   * unreadable row must not cost the other thirty-nine their writes.
   */
  it('keeps going past a row it cannot read, and still writes the rest', () => {
    const { outcomes, saved } = run(
      [brand('1', 'active'), brand('3', 'active')],
      ['1', '2', '3'],
    );

    expect(outcomes).toEqual([
      { id: '1', ok: true },
      { id: '2', ok: false, code: RETIRE_NOT_FOUND },
      { id: '3', ok: true },
    ]);
    expect(saved).toHaveLength(2);
  });

  /** The effect itself never fails: a failed *row* is data, not an error. */
  it('succeeds even when every row failed', () => {
    const { outcomes } = run([], ['1', '2']);

    expect(outcomes.every(outcome => !outcome.ok)).toBe(true);
  });

  it('does nothing for an empty selection', () => {
    const { outcomes, saved } = run([brand('1', 'active')], []);

    expect(outcomes).toEqual([]);
    expect(saved).toEqual([]);
  });
});
