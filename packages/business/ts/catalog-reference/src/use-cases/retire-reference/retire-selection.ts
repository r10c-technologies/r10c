import {
  EntityLoadRequestTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  loadAllUCFactory,
  loadUCFactory,
} from '@entifix/business';
import type {
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  EntitySelection,
} from '@entifix/core';
import { Effect } from 'effect';

import { ProductCategory } from '../../entities/product-category';
import { categorySaveRefusal } from '../../values/category-tree';
import {
  type RetirableReference,
  RetireReferenceInputTag,
  retireReferences,
} from './retire-reference';

/**
 * One page, capped. A bulk action over more rows than this is a saga rather
 * than a request (#121), and a partial result under a cap is honest where a
 * silent timeout is not.
 */
const BULK_SELECTION_CAP = 500;

/** Every stored record of one reference entity — the vocabulary is small. */
export const loadEveryReference = <T extends RetirableReference>(
  entity: EntityConstructor<T>,
) =>
  Effect.gen(function* () {
    const factory = yield* EntityRepositoryFactoryTag;
    const repository = yield* factory.for(entity, {});
    return (yield* loadAllUCFactory<T>().pipe(
      Effect.provideService(EntityRepositoryTag, repository),
      Effect.provideService(EntityLoadRequestTag, {}),
    )) as readonly T[];
  });

/**
 * Retire (or restore) what a bulk selection names: its ids, or every row
 * matching its filter less the ones it excluded. `guard` is a rule over the
 * whole store — a category tree's — handed every record, the ids and the
 * direction, and asked per row.
 */
export const retireSelection = <T extends RetirableReference>(
  entity: EntityConstructor<T>,
  options: {
    readonly selection: EntitySelection<T>;
    readonly retired: boolean;
    readonly guard?: (
      all: readonly T[],
      ids: readonly EntityId[],
      retired: boolean,
    ) => (record: T) => string | undefined;
  },
) =>
  Effect.gen(function* () {
    const { selection, retired, guard } = options;
    const factory = yield* EntityRepositoryFactoryTag;
    const repository = yield* factory.for(entity, {});

    // `Array.from`, never a spread: the packages compile through SWC's loose
    // helper, which wraps a `Set` rather than iterating it.
    const ids: readonly EntityId[] =
      selection.mode === 'ids'
        ? Array.from(selection.ids)
        : yield* Effect.gen(function* () {
            const page = yield* loadUCFactory<T>().pipe(
              Effect.provideService(EntityRepositoryTag, repository),
              Effect.provideService(EntityLoadRequestTag, {
                filtering: selection.filtering,
                page: 1,
                pageSize: BULK_SELECTION_CAP,
              } as unknown as EntityLoadRequest),
            );
            const excluded = Array.from(selection.excluded).map(String);
            return page.items
              .map(item => item.id)
              .filter(id => excluded.indexOf(String(id)) === -1);
          });

    const refuse =
      guard === undefined
        ? undefined
        : guard(yield* loadEveryReference(entity), ids, retired);

    return yield* retireReferences.pipe(
      Effect.provideService(EntityRepositoryTag, repository),
      Effect.provideService(RetireReferenceInputTag, {
        ids,
        retired,
        refuse: refuse as
          ((record: RetirableReference) => string | undefined) | undefined,
      }),
    );
  });

/**
 * Where a category would sit among the others, checked as it is saved: the
 * code a `409` answers with, or `undefined` when the tree allows it (ADR 0062).
 */
export const categorySaveConflict = (category: ProductCategory) =>
  Effect.map(loadEveryReference(ProductCategory), all =>
    categorySaveRefusal(all, category),
  );
