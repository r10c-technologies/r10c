import {
  completedEvent,
  type SequenceService,
  type TransactionCommand,
  type TransactionHandler,
  type TransactionOutcome,
} from '@r10c/entifix-transactions';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  type ConfigurationClient,
  deserializeSingleEntity,
  EntifixBuildError,
  EntifixConnError,
  type Entity,
  type EntityConstructor,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { makeMongoRepository } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

import { OUTBOX_COLLECTION, outboxDocument } from './outbox/store';

/** The catalog entities all expose a `code` (assigned here) and a `name`. */
interface Codeable extends Entity {
  code?: string;
  name?: string;
}

export interface CatalogHandlerOptions {
  /** The entity `key` a command must target (`product`). */
  key: string;
  /** The Redis sequence drawn from (`product` -> `seq:product`). */
  sequenceName: string;
  /** The code prefix (`product` -> `product-001`). */
  codePrefix: string;
}

/**
 * The domain half of the transaction facade for a catalog entity. Closes over
 * `client`/`db`/`store`/`sequence` so every method is `R = never` — the same
 * technique `makeMongoRepository` uses.
 *
 * `execute` writes the entity **and the `completed` outbox entry in one Mongo
 * transaction**, which is the reason this handler talks to the driver directly
 * instead of going through `repository.save`: the two writes must share a
 * session, and a session cannot live in the framework-free `EntityRepository`
 * port. `rollback` deletes by the transaction id (which doubles as the entity
 * id), so it is idempotent whether or not the write landed.
 *
 * `source` is the publishing slice's name, stamped onto every event this handler
 * records. It is a constructor argument rather than a `TransactionHandlerTag`
 * dependency for the same reason the rest are: the handler's methods are
 * `R = never`, so everything it needs is closed over at the composition site.
 */
export function makeCatalogTransactionHandler<T extends Codeable>(
  client: MongoClient,
  db: Db,
  store: ConfigurationClient,
  sequence: SequenceService,
  entityConstructor: EntityConstructor<T>,
  options: CatalogHandlerOptions,
  source: string,
): TransactionHandler {
  const repository = makeMongoRepository(db, entityConstructor);

  const deserialize = (command: TransactionCommand) =>
    deserializeSingleEntity(entityConstructor, command.payload).pipe(
      Effect.flatMap(entity =>
        entity === undefined
          ? Effect.fail(
              new EntifixBuildError(
                'command payload carried no entity',
                undefined,
                {
                  key: options.key,
                },
              ),
            )
          : Effect.succeed(entity as T),
      ),
    );

  return {
    validate: command =>
      Effect.gen(function* () {
        if (command.entity !== options.key) {
          return yield* Effect.fail(
            new EntifixBuildError(
              `command entity "${command.entity}" does not match "${options.key}"`,
            ),
          );
        }
        const entity = yield* deserialize(command);
        if (!entity.name) {
          return yield* Effect.fail(
            new EntifixBuildError('entity "name" is required'),
          );
        }
      }),

    lockKeys: () => [`lock:code:${options.sequenceName}`],

    execute: command =>
      Effect.gen(function* () {
        const entity = yield* deserialize(command);

        // Drawn **before** the transaction opens, and deliberately so. Mongo
        // aborts an in-flight transaction during a primary election with a
        // `TransientTransactionError`, and `withTransaction` retries the whole
        // callback; a sequence draw inside it would consume a second value on
        // every retry and leave a gap in the code series. Redis is not part of
        // the transaction and cannot be rolled back with it.
        const next = yield* sequence.next(options.sequenceName);
        entity.code = `${options.codePrefix}-${String(next).padStart(3, '0')}`;
        // Deterministic id = the transaction id, so a rollback can delete it
        // whether or not the save committed.
        entity.id = command.transactionId;

        const outcome = {
          code: entity.code,
          entityId: entity.id,
        } satisfies TransactionOutcome;

        const document = serializeEntity(entityConstructor, entity);

        yield* Effect.tryPromise({
          try: async () => {
            const session = client.startSession();
            try {
              // `withTransaction`, never a hand-rolled
              // startTransaction/commitTransaction pair: it retries the
              // `TransientTransactionError` an election produces, which the
              // application — not the driver — is expected to handle. A
              // single-node dev replica set never raises one, so a hand-rolled
              // version passes locally forever and fails in production.
              await session.withTransaction(async () => {
                await db
                  .collection(options.key)
                  .replaceOne(
                    { id: entity.id },
                    { ...document, id: entity.id },
                    { upsert: true, session },
                  );
                await db
                  .collection(OUTBOX_COLLECTION)
                  .insertOne(
                    outboxDocument(completedEvent(command, outcome, source)),
                    { session },
                  );
              });
            } finally {
              await session.endSession();
            }
          },
          catch: error =>
            new EntifixConnError(
              'Failed to commit the entity and its event',
              error,
              { transactionId: command.transactionId, key: options.key },
            ),
        });

        return outcome;
      }),

    rollback: command =>
      repository
        .delete(command.transactionId)
        .pipe(
          Effect.provideService(ConfigurationRepositoryTag, store),
          Effect.asVoid,
        ),
  };
}
