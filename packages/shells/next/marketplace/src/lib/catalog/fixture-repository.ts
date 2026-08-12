import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  ConfigurationClientInMemory,
  deserializeEntityCollection,
  EntifixConnError,
  type EntifixError,
  EntifixLogicError,
  type Entity,
  type EntityConstructor,
  type EntityFilter,
  type EntityFiltering,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  type SerializedEntity,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

/**
 * An in-memory `EntityRepository` over fixture records, so the storefront's
 * server components can run the real `loadProductsUCFactory` before
 * marketplace-service exists. Swapping to REST or Mongo later replaces this
 * context and touches nothing else.
 *
 * `@r10c/entifix-ts-testing-unit` already ships a richer one
 * (`makeInMemoryEntityRepository`, with the full RSQL operator set), but it is
 * tagged `type:testing` and the boundary rule grants that tag to spec files
 * only — production source importing it fails the build. Hence this narrower
 * sibling, which supports exactly what the storefront asks for.
 */

function unsupported(what: string): EntifixError {
  return new EntifixLogicError(
    `The storefront fixture repository does not support ${what}.`,
    undefined,
    { repository: 'fixture' },
  );
}

/**
 * Matching is deliberately narrow and **fails loudly**. A fixture repository
 * that quietly ignored a filter it did not understand would return the whole
 * catalog and look like a working page — the exact bug that survives to
 * production, where the real adapter answers `400` instead.
 *
 * Written as a switch rather than a lookup so the union narrows: `value` and
 * `values` live on different members, and only the operator tells them apart.
 */
function matches(record: SerializedEntity, filter: EntityFilter<Entity>) {
  const actual = record[filter.property as string];

  switch (filter.operator) {
    case 'eq':
      return actual === filter.value;
    case 'in':
      return filter.values.some(value => value === actual);
    case 'like':
      return String(actual ?? '')
        .toLowerCase()
        .includes(filter.value.toLowerCase());
    default:
      throw unsupported(`the "${filter.operator}" operator`);
  }
}

function applyFiltering(
  records: SerializedEntity[],
  filtering: EntityFiltering<Entity>[] | undefined,
) {
  const filters = (filtering ?? []).flat();

  // A `FilterGroup` is the one member of the union with no `property`. The
  // storefront never builds one, so rejecting it is honest rather than
  // limiting.
  if (filters.some(filter => !('property' in filter))) {
    throw unsupported('filter groups');
  }

  return records.filter(record =>
    (filters as EntityFilter<Entity>[]).every(filter =>
      matches(record, filter),
    ),
  );
}

function applySorting(
  records: SerializedEntity[],
  sorting: EntityLoadRequest<Entity>['sorting'],
) {
  const clauses = (sorting ?? []).flatMap(clause => Object.values(clause));
  if (clauses.length === 0) return records;

  return [...records].sort((left, right) => {
    for (const { property, type } of clauses) {
      const a = String(left[property as string] ?? '');
      const b = String(right[property as string] ?? '');
      const compared = a.localeCompare(b);
      if (compared !== 0) return type === 'desc' ? -compared : compared;
    }
    return 0;
  });
}

/**
 * Builds the repository context for one entity. The shape mirrors the REST
 * adapter set in marketplace-admin's `createRestRepositoryContext`, so a
 * page composing them cannot tell the two apart.
 *
 * `save`/`delete` reject: the storefront is read-only this iteration, and a
 * stub that silently succeeded would be worse than one that refuses — it would
 * let a write path get built against a repository that never stored anything.
 */
export function createFixtureRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  records: SerializedEntity[],
): Context.Context<EntityRepositoryTag> {
  const build = (rows: SerializedEntity[]) =>
    deserializeEntityCollection(entityConstructor, rows) as Effect.Effect<
      TEntity[],
      EntifixError
    >;

  return Context.make(EntityRepositoryTag, {
    get: (<T extends Entity>(id: EntityId) =>
      Effect.gen(function* () {
        const found = records.find(record => record['id'] === id);
        if (!found) {
          return yield* Effect.fail(
            new EntifixConnError(
              `No ${entityConstructor.name} with id "${String(id)}"`,
              undefined,
              { id: String(id) },
            ),
          );
        }
        const [instance] = yield* build([found]);
        return instance as unknown as T;
      })) as EntityRepositoryTag['Type']['get'],

    load: (<T extends Entity>(request: EntityLoadRequest<T>) =>
      Effect.gen(function* () {
        const matched = yield* Effect.try({
          try: () =>
            applySorting(
              applyFiltering(
                records,
                request.filtering as EntityFiltering<Entity>[] | undefined,
              ),
              request.sorting as EntityLoadRequest<Entity>['sorting'],
            ),
          catch: error => error as EntifixError,
        });

        // 1-based paging, matching the REST and Mongo adapters.
        const pageSize = request.pageSize ?? matched.length;
        const page = request.page ?? 1;
        const items = yield* build(
          matched.slice((page - 1) * pageSize, page * pageSize),
        );

        return {
          items: items as unknown as T[],
          total: matched.length,
          request,
        } satisfies EntityPage<T>;
      })) as EntityRepositoryTag['Type']['load'],

    save: () => Effect.fail(unsupported('writes')),
    delete: () => Effect.fail(unsupported('writes')),
  } as EntityRepositoryTag['Type']);
}

/**
 * The configuration context every repository method requires in its `R`
 * channel. An in-memory repository never reads a URL out of it, but the tag
 * still has to be discharged or the effect will not run — core already ships
 * the empty implementation.
 */
export const fixtureConfigurationContext = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientInMemory({}),
);
