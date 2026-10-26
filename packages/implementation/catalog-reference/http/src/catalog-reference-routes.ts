import type { Permission, PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  type EntityConstructor,
  envelopeEntityName,
  readWireSelection,
} from '@entifix/core';
import {
  type EntityRouteGuard,
  EntityRouteRefusal,
  makeEntityRoutes,
  requirePermission,
  routeFailure,
} from '@entifix/service-shell';
import {
  categoryRetireGuard,
  categorySaveConflict,
  DictionaryTerm,
  ProductBrand,
  ProductCategory,
  type RetirableReference,
  RETIRE_PRODUCT_BRAND,
  RETIRE_PRODUCT_CATEGORY,
  retireSelection,
} from '@r10c/business-ts-catalog-reference';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link catalogReferenceRoutes}. */
export type CatalogReferenceRouteServices =
  EntityRepositoryFactoryTag | TokenServiceTag | PolicyDecisionTag;

/**
 * The operator-authored vocabulary is **read by anyone** — the storefront's
 * browse tree and the back office's classification are the same records —
 * and written only behind the entity's own permission.
 */
type VocabularyGuard = Extract<
  EntityRouteGuard,
  { kind: 'public' | 'permission' }
>;

const vocabularyGuard = (): {
  readonly read: VocabularyGuard;
  readonly write: VocabularyGuard;
} => ({ read: { kind: 'public' }, write: { kind: 'permission' } });

/**
 * `POST /api/<key>/retire` and `/restore` — the bulk bar's verb over a
 * selection. The wire form is arrays, because a `Set` does not survive JSON;
 * anything that is not a selection is refused rather than defaulted, since
 * the body decides which rows a write touches.
 */
const retireRoutes = <T extends RetirableReference>(
  entity: EntityConstructor<T>,
  permission: Permission,
  guard?: Parameters<typeof retireSelection<T>>[1]['guard'],
) => {
  const key = envelopeEntityName(entity);
  const route = (retired: boolean) =>
    requirePermission(permission)(() =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = (yield* request.json) as { selection?: unknown };
        const selection = readWireSelection<T>(body.selection);
        if (!selection) {
          return yield* HttpServerResponse.json(
            {
              error: 'invalid request body',
              code: 'invalidBody',
              detail:
                'A bulk request carries a `selection` in `ids` or `matching` mode.',
            },
            { status: 400 },
          );
        }
        const outcomes = yield* retireSelection(entity, {
          selection,
          retired,
          ...(guard === undefined ? {} : { guard }),
        });
        return yield* HttpServerResponse.json({
          meta: { type: 'bulkOutcome', entity: key },
          data: outcomes,
        });
      }).pipe(Effect.catch(routeFailure)),
    );
  return [
    HttpRouter.route('POST', `/api/${key}/retire`, route(true)),
    HttpRouter.route('POST', `/api/${key}/restore`, route(false)),
  ] as const;
};

/**
 * marketplace-service's vocabulary surface: brands, categories and the
 * characteristic dictionary. A category is saved only where the tree allows
 * it (ADR 0062) — the refusal is a `409` naming the rule — and one with
 * active children cannot be retired.
 */
export const catalogReferenceRoutes = Layer.mergeAll(
  makeEntityRoutes(DictionaryTerm, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard(),
  }),
  makeEntityRoutes(ProductBrand, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard(),
  }),
  makeEntityRoutes.for<EntityRepositoryFactoryTag>()(ProductCategory, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: vocabularyGuard(),
    prepare: category =>
      Effect.flatMap(categorySaveConflict(category), conflict =>
        conflict === undefined
          ? Effect.succeed(category)
          : Effect.fail(new EntityRouteRefusal(409, conflict)),
      ).pipe(
        // A store that cannot be read is no reason to save past the rule.
        Effect.mapError(error =>
          error instanceof EntityRouteRefusal
            ? error
            : new EntityRouteRefusal(409, 'categoryTreeUnreadable'),
        ),
      ),
  }),
  HttpRouter.addAll([
    ...retireRoutes(ProductBrand, RETIRE_PRODUCT_BRAND),
    ...retireRoutes(
      ProductCategory,
      RETIRE_PRODUCT_CATEGORY,
      categoryRetireGuard,
    ),
  ]),
);
