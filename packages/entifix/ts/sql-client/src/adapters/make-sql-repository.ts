import { randomUUID } from 'node:crypto';

import type { SqlClient } from '@effect/sql';
import type { EntityRepository } from '@r10c/entifix-ts-business';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
  EntifixConnError,
  type EntifixError,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLoadRequest,
  type EntityPage,
  extractMetaEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { translateFiltering, translateSorting } from './sql-filter-translator';

/** A row as the driver returns it: column names, untransformed. */
type SqlRow = Record<string, unknown>;

function tableName<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string {
  const metaEntity = extractMetaEntity(entityConstructor);
  return metaEntity.key ?? metaEntity.name;
}

function toEntityId(entityOrId: EntityId | Entity): EntityId {
  return entityOrId != null && typeof entityOrId === 'object'
    ? (entityOrId as Entity).id
    : (entityOrId as EntityId);
}

/**
 * Builds an {@link EntityRepository} for a single entity type, backed by an
 * `@effect/sql` client. The `sql` client and `entityConstructor` are captured in
 * closures, so every method's Effect has no outstanding requirements
 * (`R = never`) and is assignable to the interface's `ConfigurationRepositoryTag`
 * channel.
 *
 * This is the relational mirror of `makeMongoRepository`, and it is short for the
 * same reason: the entifix serializer is store-agnostic. `serializeEntity` emits
 * a **flat record keyed by `alias ?? name`**, which for a scalar entity *is* a
 * table row, and the deserializer consumes the same shape coming back. So the
 * entity's own `alias` metadata is the column mapping — there is no separate
 * table/column mapping layer, and none is needed.
 *
 * Table name = the entity's `key` (falling back to its class name), the same rule
 * the Mongo adapter uses for a collection.
 *
 * **v1 handles flat scalar entities.** Embedded links and `linkCollection`
 * members have no single-column representation, so an entity carrying them needs
 * either a join-aware adapter or `alias`ed scalar foreign keys.
 *
 * Two dialect assumptions, both true of Postgres and stated so a future MySQL or
 * SQLite adapter knows what to override: `ILIKE` for case-insensitive matching,
 * and `COUNT(*)::int` for the total. The client must **not** be configured with
 * name transformation (`transformResultNames`), since `alias` is already the
 * mapping and a second one would fight it.
 */
export function makeSqlRepository<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  entityConstructor: EntityConstructor<TEntity>,
): EntityRepository {
  const table = sql(tableName(entityConstructor));

  const fail = (
    message: string,
    error: unknown,
    details?: Record<string, unknown>,
  ) =>
    new EntifixConnError(message, error, {
      entity: entityConstructor.name,
      ...details,
    });

  const load = <T extends Entity>(request: EntityLoadRequest<T>) =>
    Effect.gen(function* () {
      // The translators are framework-free and reject an undeclared member by
      // throwing, so the throw is caught back into the failure channel here —
      // the same crossing `readLoadRequest` makes for the URL codec.
      const clauses = yield* Effect.try({
        try: () => ({
          where: translateFiltering(
            sql,
            entityConstructor,
            request.filtering as EntityLoadRequest<TEntity>['filtering'],
          ),
          orderBy: translateSorting(
            sql,
            entityConstructor,
            request.sorting as EntityLoadRequest<TEntity>['sorting'],
          ),
        }),
        catch: error => error as EntifixError,
      });

      const where =
        clauses.where === undefined
          ? sql.literal('')
          : sql`WHERE ${clauses.where}`;
      const orderBy =
        clauses.orderBy === undefined
          ? sql.literal('')
          : sql`ORDER BY ${clauses.orderBy}`;

      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const offset = (page - 1) * pageSize;

      const rows = yield* sql<SqlRow>`
        SELECT * FROM ${table} ${where} ${orderBy} LIMIT ${pageSize} OFFSET ${offset}
      `.pipe(
        Effect.mapError(error =>
          fail('Failed to load entities from SQL', error),
        ),
      );

      const counted = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*)::int AS count FROM ${table} ${where}`.pipe(
        Effect.mapError(error =>
          fail('Failed to count entities in SQL', error),
        ),
      );

      const items = yield* deserializeEntityCollection(entityConstructor, [
        ...rows,
      ]);

      return {
        items: items as unknown as T[],
        total: counted[0]?.count ?? 0,
        request,
      } satisfies EntityPage<T>;
    });

  const get = <T extends Entity>(id: EntityId) =>
    Effect.gen(function* () {
      const rows = yield* sql<SqlRow>`
        SELECT * FROM ${table} WHERE ${sql('id')} = ${id} LIMIT 1
      `.pipe(
        Effect.mapError(error =>
          fail('Failed to read entity from SQL', error, { id }),
        ),
      );

      const entity = yield* deserializeSingleEntity(
        entityConstructor,
        rows[0] ?? null,
      );
      if (entity === undefined) {
        return yield* Effect.fail(fail('Entity not found', undefined, { id }));
      }
      return entity as unknown as T;
    });

  const save = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const serialized = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      // A create arrives without an id, so the store mints one — the same
      // contract as the Mongo adapter, and what lets `save` double as the upsert
      // behind both POST and PUT.
      const id = entity.id ?? randomUUID();
      // The serializer drops `undefined`, so the resolved id is spread back in.
      const row: SqlRow = { ...serialized, id };

      const updatable = Object.keys(row).filter(column => column !== 'id');
      // An entity whose only member is its id has nothing to update; `DO UPDATE
      // SET` with an empty list is a syntax error, so it degrades to a no-op.
      const onConflict =
        updatable.length === 0
          ? sql.literal('DO NOTHING')
          : sql`DO UPDATE SET ${sql.csv(
              updatable.map(
                column => sql`${sql(column)} = EXCLUDED.${sql(column)}`,
              ),
            )}`;

      yield* sql`
        INSERT INTO ${table} ${sql.insert(row)}
        ON CONFLICT (${sql('id')}) ${onConflict}
      `.pipe(
        Effect.mapError(error =>
          fail('Failed to save entity to SQL', error, { id }),
        ),
      );

      entity.id = id;
      return entity;
    });

  const del = <T extends Entity>(entityOrId: EntityId | T) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      yield* sql`DELETE FROM ${table} WHERE ${sql('id')} = ${id}`.pipe(
        Effect.mapError(error =>
          fail('Failed to delete entity from SQL', error, { id }),
        ),
      );
    });

  // The interface types each method's requirement channel as
  // `ConfigurationRepositoryTag`; these effects require nothing (`never`), which
  // is assignable. Cast through the interface to keep the generic signatures.
  return {
    load,
    get,
    save,
    delete: del,
  } as unknown as EntityRepository;
}

export type { EntifixError };
