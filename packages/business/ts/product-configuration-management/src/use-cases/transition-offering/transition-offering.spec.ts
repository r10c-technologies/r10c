import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import type { OfferingStatus } from '../../values/offering-status.js';
import type { OfferingTransition } from '../../values/offering-transition.js';
import {
  ILLEGAL_OFFERING_TRANSITION,
  IllegalOfferingTransition,
  transitionOffering,
  TransitionOfferingInputTag,
} from './transition-offering.js';

/** `EntifixError` is abstract, so a double needs a concrete failure of its own. */
class NotFound extends Error {}

const offering = (id: string, status: OfferingStatus): ProductOffering => {
  const one = new ProductOffering(`Offering ${id}`, `spec-${id}`);
  one.id = id;
  one.status = status;
  return one;
};

/**
 * A repository holding the rows by id. `save` records what it was handed, so a
 * test can assert the **write** rather than only the returned record — an
 * implementation that mutated the instance and never saved would pass
 * otherwise, and would lose the transition on the next read.
 */
const repositoryOf = (...rows: ProductOffering[]) => {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const saved: ProductOffering[] = [];

  const repository = {
    get: <TEntity extends Entity>(id: EntityId) => {
      const row = byId.get(String(id));
      return row
        ? Effect.succeed(row as unknown as TEntity)
        : Effect.fail(new NotFound('not found'));
    },
    load: vi.fn(),
    save: <TEntity extends Entity>(entity: TEntity) => {
      saved.push(entity as unknown as ProductOffering);
      return Effect.succeed(entity);
    },
    delete: vi.fn(),
  };

  return { repository, saved };
};

const run = (
  rows: ProductOffering[],
  id: EntityId,
  transition: OfferingTransition,
) => {
  const { repository, saved } = repositoryOf(...rows);
  const exit = Effect.runSyncExit(
    transitionOffering.pipe(
      Effect.provideService(TransitionOfferingInputTag, { id, transition }),
      // The repository's signature threads a configuration requirement this
      // path never uses; the cast keeps the double honest about the members
      // actually exercised.
      Effect.provideService(
        EntityRepositoryTag,
        repository as unknown as typeof EntityRepositoryTag.Service,
      ),
    ) as Effect.Effect<ProductOffering, IllegalOfferingTransition, never>,
  );
  return { exit, saved };
};

describe('transitionOffering', () => {
  it('publishes a draft and writes it', () => {
    const { exit, saved } = run([offering('1', 'draft')], '1', 'publish');

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe('published');
  });

  it('republishes a published offering, because that is how an edit ships', () => {
    const { exit, saved } = run([offering('1', 'published')], '1', 'publish');

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(saved[0].status).toBe('published');
  });

  it('unpublishes a published offering', () => {
    const { saved } = run([offering('1', 'published')], '1', 'unpublish');

    expect(saved[0].status).toBe('unpublished');
  });

  /**
   * The refusal must reach the caller **and** leave the record alone. A version
   * that failed after saving would take the storefront record down and then
   * report an error, which is the worst of both.
   */
  it('refuses to unpublish a draft, and writes nothing', () => {
    const { exit, saved } = run([offering('1', 'draft')], '1', 'unpublish');

    expect(Exit.isFailure(exit)).toBe(true);
    expect(saved).toEqual([]);
  });

  it('says what it refused, in terms a route can render', () => {
    const { exit } = run([offering('7', 'unpublished')], '7', 'unpublish');

    const failure = Exit.isFailure(exit)
      ? (exit.cause as unknown as { error: IllegalOfferingTransition }).error
      : undefined;

    expect(failure).toBeInstanceOf(IllegalOfferingTransition);
    expect(failure?.code).toBe(ILLEGAL_OFFERING_TRANSITION);
    expect(failure?.from).toBe('unpublished');
    expect(failure?.transition).toBe('unpublish');
    expect(failure?.id).toBe('7');
  });

  it('propagates a record it cannot read', () => {
    const { exit, saved } = run([], 'missing', 'publish');

    expect(Exit.isFailure(exit)).toBe(true);
    expect(saved).toEqual([]);
  });
});
