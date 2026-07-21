import { randomUUID } from 'node:crypto';

import type { EntityRepository } from '@r10c/entifix-ts-business';
import {
  EntifixConnError,
  type EntifixError,
  type Entity,
  type EntityFilter,
  type EntityFiltering,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  type EntitySorting,
  type FilterGroup,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/** Escapes a string so `like`/`nlike` match literally, as the Mongo adapter does. */
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isFilterGroup = <TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> =>
  !('property' in node) && (node.operator === 'and' || node.operator === 'or');

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  // Mongo sorts missing values below present ones.
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime();
  }
  return String(left).localeCompare(String(right));
};

const matchesNode = <TEntity extends Entity>(
  item: TEntity,
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): boolean => {
  if (isFilterGroup(node)) {
    return node.operator === 'or'
      ? node.values.some((child) => matchesNode(item, child))
      : node.values.every((child) => matchesNode(item, child));
  }

  const actual = (item as Record<string, unknown>)[String(node.property)];

  switch (node.operator) {
    case 'eq':
      return actual === node.value;
    case 'ne':
      return actual !== node.value;
    case 'gt':
      return compareValues(actual, node.value) > 0;
    case 'gte':
      return compareValues(actual, node.value) >= 0;
    case 'lt':
      return compareValues(actual, node.value) < 0;
    case 'lte':
      return compareValues(actual, node.value) <= 0;
    case 'in':
      return node.values.includes(actual as TEntity[keyof TEntity]);
    case 'nin':
      return !node.values.includes(actual as TEntity[keyof TEntity]);
    case 'between':
      return (
        compareValues(actual, node.start) >= 0 &&
        compareValues(actual, node.end) <= 0
      );
    case 'nbetween':
      return !(
        compareValues(actual, node.start) >= 0 &&
        compareValues(actual, node.end) <= 0
      );
    case 'like':
      return new RegExp(escapeRegex(node.value), 'i').test(String(actual));
    case 'nlike':
      return !new RegExp(escapeRegex(node.value), 'i').test(String(actual));
    case 'isNull':
      return actual == null;
    case 'isNotNull':
      return actual != null;
    default: {
      // Exhaustiveness guard — a new operator must be handled explicitly.
      const never: never = node;
      return never;
    }
  }
};

const applyFiltering = <TEntity extends Entity>(
  items: TEntity[],
  filtering?: EntityFiltering<TEntity>[],
): TEntity[] => {
  if (!filtering || filtering.length === 0) return items;
  // Every top-level entry is combined with `and`, matching `translateFiltering`.
  const nodes = filtering.flatMap((entry) =>
    Array.isArray(entry) ? entry : [entry],
  );
  return items.filter((item) => nodes.every((node) => matchesNode(item, node)));
};

const applySorting = <TEntity extends Entity>(
  items: TEntity[],
  sorting?: EntitySorting<TEntity>[],
): TEntity[] => {
  if (!sorting || sorting.length === 0) return items;

  const entries = sorting.flatMap((record) =>
    Object.keys(record)
      .map(Number)
      .sort((left, right) => left - right)
      .map((priority) => record[priority])
      .filter((entry) => entry != null),
  );

  return [...items].sort((left, right) => {
    for (const entry of entries) {
      const property = String(entry.property);
      const result = compareValues(
        (left as Record<string, unknown>)[property],
        (right as Record<string, unknown>)[property],
      );
      if (result !== 0) return entry.type === 'desc' ? -result : result;
    }
    return 0;
  });
};

export interface InMemoryEntityRepository extends EntityRepository {
  /** Everything currently stored, in insertion order. */
  readonly items: Entity[];
  /** Replaces the contents, discarding whatever was there. */
  seed(items: Entity[]): void;
  /**
   * Makes the next call to any method fail with `error`, so error branches are
   * reachable without reaching for a mocking library.
   */
  failNext(error: EntifixError): void;
}

/**
 * In-memory {@link EntityRepository}: the default double for anything that
 * depends on persistence.
 *
 * Its semantics deliberately mirror `makeMongoRepository` — same filtering and
 * sorting rules, same 1-based paging with a default page size of 10, same
 * "entity not found" failure, same id minting on create — and
 * `describeEntityRepositoryContract` holds both to that shared contract.
 */
export const makeInMemoryEntityRepository = (
  seed: Entity[] = [],
): InMemoryEntityRepository => {
  let items = [...seed];
  let pendingFailure: EntifixError | undefined;

  /** Consumes a queued failure, if one was armed. */
  const guard = <TValue>(
    run: () => Effect.Effect<TValue, EntifixError>,
  ): Effect.Effect<TValue, EntifixError> => {
    if (pendingFailure !== undefined) {
      const failure = pendingFailure;
      pendingFailure = undefined;
      return Effect.fail(failure);
    }
    return run();
  };

  const load = <TEntity extends Entity>(request: EntityLoadRequest<TEntity>) =>
    guard(() => {
      const matched = applySorting(
        applyFiltering(items as TEntity[], request.filtering),
        request.sorting,
      );
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const start = (page - 1) * pageSize;

      return Effect.succeed({
        items: matched.slice(start, start + pageSize),
        total: matched.length,
        request,
      } satisfies EntityPage<TEntity>);
    });

  const get = <TEntity extends Entity>(id: EntityId) =>
    guard(() => {
      const found = items.find((item) => item.id === id);
      return found === undefined
        ? Effect.fail(
            new EntifixConnError('Entity not found', undefined, { id }),
          )
        : Effect.succeed(found as TEntity);
    });

  const save = <TEntity extends Entity>(entity: TEntity) =>
    guard(() => {
      // A create arrives without an id, so the store mints one — same rule the
      // Mongo adapter follows.
      entity.id = entity.id ?? randomUUID();
      const index = items.findIndex((item) => item.id === entity.id);
      if (index === -1) {
        items.push(entity);
      } else {
        items[index] = entity;
      }
      return Effect.succeed(entity);
    });

  const remove = <TEntity extends Entity>(entityOrId: EntityId | TEntity) =>
    guard(() => {
      const id =
        entityOrId != null && typeof entityOrId === 'object'
          ? entityOrId.id
          : entityOrId;
      items = items.filter((item) => item.id !== id);
      return Effect.succeed(undefined);
    });

  return {
    load,
    get,
    save,
    delete: remove,
    get items() {
      return items;
    },
    seed: (next: Entity[]) => {
      items = [...next];
    },
    failNext: (error: EntifixError) => {
      pendingFailure = error;
    },
    // Each method closes over its own state, so nothing is required from the
    // Effect environment; that is assignable to the interface's channel.
  } as unknown as InMemoryEntityRepository;
};
