import {
  EntityLoadRequestTag,
  EntityRepositoryFactoryTag,
  EntityRepositoryTag,
  loadAllUCFactory,
} from '@entifix/business';
import {
  type EntityConstructor,
  type EntityId,
  type EntitySelection,
  loadRequestFor,
} from '@entifix/core';
import { refuseSelectionAbove } from '@r10c/business-ts-common';
import { Effect } from 'effect';

import { ProductCategory } from '../../entities/product-category';
import { categoryRefusal } from '../../failures/category-failures';
import { categorySaveRefusal } from '../../values/category-tree';
import {
  type RetirableReference,
  RetireReferenceInputTag,
  retireReferences,
} from './retire-reference';

/**
 * The most rows one bulk request takes. A bulk action over more is a saga
 * rather than a request (#121), so a larger selection is refused whole rather
 * than timed out or quietly cut short.
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
            const page = yield* repository.load<T>(
              loadRequestFor(selection, {
                page: 1,
                pageSize: BULK_SELECTION_CAP + selection.excluded.size + 1,
              }),
            );
            const excluded = Array.from(selection.excluded).map(String);
            return page.items
              .map(item => item.id)
              .filter(id => excluded.indexOf(String(id)) === -1);
          });
    // Refused whole, before any row is touched: acting on the first
    // BULK_SELECTION_CAP rows and saying nothing about the rest is the silent
    // truncation ADR 0035 rules out.
    yield* refuseSelectionAbove(BULK_SELECTION_CAP, ids.length);

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
 * category itself when the tree allows it, or the rule it breaks (ADR 0062).
 * A store that cannot be read fails as the store does — never as a save
 * allowed past a rule nobody could check.
 */
export const checkCategorySave = (category: ProductCategory) =>
  Effect.gen(function* () {
    const all = yield* loadEveryReference(ProductCategory);
    const refused = categorySaveRefusal(all, category);
    return refused === undefined
      ? category
      : yield* categoryRefusal(refused, category.name);
  });
