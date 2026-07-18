import {
  type SequenceService,
  type TransactionCommand,
  type TransactionHandler,
  type TransactionOutcome,
} from '@r10c/entifix-transactions';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  type ConfigurationStore,
  deserializeSingleEntity,
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
} from '@r10c/entifix-ts-core';
import { makeMongoRepository } from '@r10c/entifix-ts-mongo-client';
import { Effect } from 'effect';
import type { Db } from 'mongodb';

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
 * `db`/`store`/`sequence` so every method is `R = never` — the same technique
 * `makeMongoRepository` uses. `execute` draws an atomic Redis sequence value,
 * formats the code, and persists; `rollback` deletes by the transaction id
 * (which doubles as the entity id), so it is idempotent whether or not the write
 * landed.
 */
export function makeCatalogTransactionHandler<T extends Codeable>(
  db: Db,
  store: ConfigurationStore,
  sequence: SequenceService,
  entityConstructor: EntityConstructor<T>,
  options: CatalogHandlerOptions,
): TransactionHandler {
  const repository = makeMongoRepository(db, entityConstructor);

  const deserialize = (command: TransactionCommand) =>
    deserializeSingleEntity(entityConstructor, command.payload).pipe(
      Effect.flatMap((entity) =>
        entity === undefined
          ? Effect.fail(
              new EntifixBuildError('command payload carried no entity', undefined, {
                key: options.key,
              }),
            )
          : Effect.succeed(entity as T),
      ),
    );

  return {
    validate: (command) =>
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

    execute: (command) =>
      Effect.gen(function* () {
        const entity = yield* deserialize(command);
        const next = yield* sequence.next(options.sequenceName);
        entity.code = `${options.codePrefix}-${String(next).padStart(3, '0')}`;
        // Deterministic id = the transaction id, so a rollback can delete it
        // whether or not the save committed.
        entity.id = command.transactionId;

        const saved = yield* repository
          .save(entity)
          .pipe(Effect.provideService(ConfigurationRepositoryTag, store));

        return {
          code: entity.code,
          entityId: saved.id,
        } satisfies TransactionOutcome;
      }),

    rollback: (command) =>
      repository
        .delete(command.transactionId)
        .pipe(
          Effect.provideService(ConfigurationRepositoryTag, store),
          Effect.asVoid,
        ),
  };
}
