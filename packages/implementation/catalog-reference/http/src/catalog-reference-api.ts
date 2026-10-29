import {
  defineEntityApi,
  type EntityApiRequest,
  verbEndpoint,
} from '@entifix/business';
import {
  type EntityConstructor,
  entityKey,
  envelopeEntityName,
  readWireSelection,
} from '@entifix/core';
import {
  CategoryCycle,
  CategoryHasActiveChildren,
  CategoryParentMissing,
  CategoryParentRetired,
  categoryRetireGuard,
  CategoryTooDeep,
  checkCategorySave,
  DictionaryTerm,
  ProductBrand,
  ProductCategory,
  RestoreProductBrandUC,
  RestoreProductCategoryUC,
  type RetirableReference,
  RetireProductBrandUC,
  RetireProductCategoryUC,
  retireSelection,
} from '@r10c/business-ts-catalog-reference';
import { InvalidBody } from '@r10c/business-ts-common';
import { Effect } from 'effect';

/**
 * The operator-authored vocabulary is **read by anyone** — the storefront's
 * browse tree and the back office's classification are the same records —
 * and written only behind the entity's own permission.
 */
const vocabularyGuard = {
  read: { kind: 'public' },
  write: { kind: 'permission' },
} as const;

/**
 * The bulk bar's verb over a selection, one direction or the other. The wire
 * form is arrays, because a `Set` does not survive JSON; anything that is not
 * a selection is refused rather than defaulted, since the body decides which
 * rows a write touches. Each row reports its own outcome.
 */
const bulkStatus =
  <T extends RetirableReference>(
    entity: EntityConstructor<T>,
    retired: boolean,
    guard?: Parameters<typeof retireSelection<T>>[1]['guard'],
  ) =>
  (request: EntityApiRequest) =>
    Effect.gen(function* () {
      const selection = readWireSelection<T>(
        (request.payload as { readonly selection?: unknown }).selection,
      );
      if (!selection) {
        return yield* new InvalidBody({
          reason:
            'a bulk request carries a `selection` in `ids` or `matching` mode',
        });
      }
      const outcomes = yield* retireSelection(entity, {
        selection,
        retired,
        ...(guard === undefined ? {} : { guard }),
      });
      return {
        meta: { type: 'bulkOutcome', entity: envelopeEntityName(entity) },
        data: outcomes,
      };
    });

const retireBrands = verbEndpoint(RetireProductBrandUC, {
  handler: bulkStatus(ProductBrand, true),
});
const restoreBrands = verbEndpoint(RestoreProductBrandUC, {
  handler: bulkStatus(ProductBrand, false),
});
const retireCategories = verbEndpoint(RetireProductCategoryUC, {
  handler: bulkStatus(ProductCategory, true, categoryRetireGuard),
});
const restoreCategories = verbEndpoint(RestoreProductCategoryUC, {
  handler: bulkStatus(ProductCategory, false, categoryRetireGuard),
});

export const dictionaryTermApi = defineEntityApi(
  DictionaryTerm,
  entityKey(DictionaryTerm, 'dictionary-term'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard,
  },
);

export const productBrandApi = defineEntityApi(
  ProductBrand,
  entityKey(ProductBrand, 'product-brand'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard,
    useCases: [retireBrands, restoreBrands],
  },
);

/**
 * A category is saved only where the tree allows it (ADR 0062), and one with
 * an active child can be retired neither by the verb nor by a save that
 * writes `status` — the edit form's field is a second way to retire.
 */
export const productCategoryApi = defineEntityApi(
  ProductCategory,
  entityKey(ProductCategory, 'product-category'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard,
    prepare: checkCategorySave,
    errors: [
      CategoryParentMissing,
      CategoryParentRetired,
      CategoryCycle,
      CategoryTooDeep,
      CategoryHasActiveChildren,
    ],
    useCases: [retireCategories, restoreCategories],
  },
);
