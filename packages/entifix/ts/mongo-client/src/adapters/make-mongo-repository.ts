import type { EntityRepository } from '@r10c/entifix-ts-business';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
  EntifixConnError,
  EntifixError,
  Entity,
  EntityConstructor,
  EntityId,
  EntityLoadRequest,
  EntityPage,
  extractMetaEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

import {
  translateFiltering,
  translateSorting,
} from './filter-translator';

/** Projection that drops Mongo's internal `_id` from read results. */
const WITHOUT_MONGO_ID = { projection: { _id: 0 } } as const;

function collectionName<TEntity extends Entity>(
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
 * Builds an {@link EntityRepository} for a single entity type, backed by a live
 * mongodb {@link Db}. The `db` and `entityConstructor` are captured in closures,
 * so every method's Effect has no outstanding requirements (`R = never`) and is
 * assignable to the interface's `ConfigurationRepositoryTag` channel.
 *
 * Collection name = the entity's `key` (falling back to its class name). Reads
 * reuse the shared entifix deserializer (rebuilding links from embedded objects
 * or scalar FKs); writes reuse the shared serializer. Mongo failures surface as
 * {@link EntifixConnError}.
 *
 * This is the Mongo mirror of the REST `buildEntityRestAdapter*` builders.
 */
export function makeMongoRepository<TEntity extends Entity>(
  db: Db,
  entityConstructor: EntityConstructor<TEntity>,
): EntityRepository {
  const collection = db.collection(collectionName(entityConstructor));

  const fail = (message: string, error: unknown, details?: Record<string, unknown>) =>
    new EntifixConnError(message, error, {
      entity: entityConstructor.name,
      ...details,
    });

  const load = <T extends Entity>(request: EntityLoadRequest<T>) =>
    Effect.gen(function* () {
      const filter = translateFiltering(request.filtering);
      const sort = translateSorting(request.sorting);
      const page = request.page ?? 1;
      const pageSize = request.pageSize ?? 10;
      const skip = (page - 1) * pageSize;

      const docs = yield* Effect.tryPromise({
        try: () =>
          collection
            .find(filter, WITHOUT_MONGO_ID)
            .sort(sort)
            .skip(skip)
            .limit(pageSize)
            .toArray(),
        catch: error => fail('Failed to load entities from MongoDB', error),
      });
      const total = yield* Effect.tryPromise({
        try: () => collection.countDocuments(filter),
        catch: error => fail('Failed to count entities in MongoDB', error),
      });

      const items = yield* deserializeEntityCollection(entityConstructor, docs);

      return {
        items: items as unknown as T[],
        total,
        request,
      } satisfies EntityPage<T>;
    });

  const get = <T extends Entity>(id: EntityId) =>
    Effect.gen(function* () {
      const doc = yield* Effect.tryPromise({
        try: () => collection.findOne({ id }, WITHOUT_MONGO_ID),
        catch: error => fail('Failed to read entity from MongoDB', error, { id }),
      });
      const entity = yield* deserializeSingleEntity(entityConstructor, doc);
      if (entity === undefined) {
        return yield* Effect.fail(
          fail(`Entity not found`, undefined, { id }),
        );
      }
      return entity as unknown as T;
    });

  const save = <T extends Entity>(entity: T) =>
    Effect.gen(function* () {
      const doc = serializeEntity(
        entityConstructor,
        entity as unknown as TEntity,
      );
      const id = entity.id;
      yield* Effect.tryPromise({
        try: () =>
          id == null
            ? collection.insertOne({ ...doc })
            : collection.replaceOne({ id }, doc, { upsert: true }),
        catch: error => fail('Failed to save entity to MongoDB', error, { id }),
      });
      return entity;
    });

  const del = <T extends Entity>(entityOrId: EntityId | T) =>
    Effect.gen(function* () {
      const id = toEntityId(entityOrId);
      yield* Effect.tryPromise({
        try: () => collection.deleteOne({ id }),
        catch: error =>
          fail('Failed to delete entity from MongoDB', error, { id }),
      });
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
