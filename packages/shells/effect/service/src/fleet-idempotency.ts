import { IdempotencyStoreTag } from '@entifix/business';
import type { EntifixBuildError, StoreFailure } from '@entifix/core';
import { MongoClientTag, MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureIdempotencyIndexes,
  makeMongoIdempotencyStore,
} from '@entifix/mongo/transactions';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

import type { FleetConfiguration } from './fleet-service.js';

/**
 * The store a service's `requireIdempotencyKey` routes remember their answers
 * in (ADR 0068): the service's own database by default, or the database
 * `dbName` names on its pool — for a service whose stores are all per tenant,
 * where a key names no organization to resolve one from.
 *
 * Retention is the service's `idempotency.retentionMs` row: how long a key
 * replays its first answer. Past it the key is free again — long enough to
 * outlast every redelivery and client retry, which is all a key is for.
 */
const storeOver = (
  retentionMs: number,
  database: Effect.Effect<Db, never, MongoClientTag | MongoDatabaseTag>,
) =>
  Layer.effect(
    IdempotencyStoreTag,
    Effect.gen(function* () {
      const db = yield* database;
      yield* ensureIdempotencyIndexes(db);
      return makeMongoIdempotencyStore(db, { retentionMs });
    }),
  );

export function fleetIdempotencyLayer(
  configuration: FleetConfiguration,
): Effect.Effect<
  Layer.Layer<IdempotencyStoreTag, StoreFailure, MongoDatabaseTag>,
  EntifixBuildError
>;
export function fleetIdempotencyLayer(
  configuration: FleetConfiguration,
  dbName: string,
): Effect.Effect<
  Layer.Layer<IdempotencyStoreTag, StoreFailure, MongoClientTag>,
  EntifixBuildError
>;
export function fleetIdempotencyLayer(
  { store }: FleetConfiguration,
  dbName?: string,
) {
  return Effect.map(
    store.in('idempotency').getNumber('retentionMs'),
    retentionMs =>
      storeOver(
        retentionMs,
        dbName === undefined
          ? MongoDatabaseTag
          : Effect.map(MongoClientTag, client => client.db(dbName)),
      ),
  );
}
