import {
  ConfigurationRepositoryTag,
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
} from '@entifix/business';
import {
  deserializeSingleEntity,
  EntifixBuildError,
  EntifixConnError,
  type EntifixError,
  envelopeEntityName,
  isFailure,
  serializeEntity,
  type TransitionalFailure,
  Unavailable,
} from '@entifix/core';
import { makeMongoRepository, MongoClientTag } from '@entifix/mongo';
import {
  drainOutbox,
  ensureOutboxIndexes,
  makeMongoOutbox,
  makeMongoUnitsOfWork,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import {
  CommandTag,
  completedEvent,
  EventBusTag,
  EventSourceTag,
  LockServiceTag,
  readCommandEnvelope,
  SequenceServiceTag,
  type TransactionCommand,
  type TransactionHandler,
  TransactionHandlerTag,
  TransactionOutboxTag,
} from '@entifix/transactions';
import {
  acceptTransaction,
  completeTransaction,
} from '@entifix/transactions/engine';
import {
  ProductSpecification,
  refuseSpecificationMedia,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer } from 'effect';
import type { Db } from 'mongodb';

/**
 * The transaction engine's handler port still speaks the class tree, and it
 * leaves with the engine. A business failure reaching it is the refusal the
 * engine has always read as a build error; a technical one, the connection
 * error it has always retried.
 */
const toEngineError = (failure: TransitionalFailure): EntifixError =>
  !isFailure(failure)
    ? failure
    : failure.family === 'business'
      ? new EntifixBuildError(`${failure._tag}: ${failure.code}`)
      : new EntifixConnError(`${failure._tag}: ${failure.code}`);

export const SPECIFICATION_COLLECTION =
  envelopeEntityName(ProductSpecification);

/** The sequence a specification's code is drawn from, and its prefix. */
const SEQUENCE = 'product-specification';
const CODE_PREFIX = 'product';

/**
 * A specification create as the transaction engine's handler (ADR 0028):
 * validated before anything is locked, executed under the code-sequence lock,
 * and rolled back by id if the execute fails.
 *
 * ⚠️ **The record and its `completed` event are one unit.** A crash between
 * two separate writes would leave a specification the tracker reports as
 * still pending, or a completion for a record that never landed.
 */
const specificationHandler = (
  db: Db,
  units: ReturnType<typeof makeMongoUnitsOfWork>,
  sequence: SequenceServiceTag['Service'],
  configuration: ConfigurationRepositoryTag['Service'],
  source: string,
): TransactionHandler => {
  const deserialize = (command: TransactionCommand) =>
    deserializeSingleEntity(ProductSpecification, command.payload).pipe(
      Effect.flatMap(entity =>
        entity === undefined
          ? Effect.fail(
              new EntifixBuildError(
                'command payload carried no entity',
                undefined,
                {
                  key: SPECIFICATION_COLLECTION,
                },
              ),
            )
          : Effect.succeed(entity as ProductSpecification),
      ),
    );

  return {
    validate: command =>
      Effect.gen(function* () {
        if (command.entity !== SPECIFICATION_COLLECTION) {
          return yield* Effect.fail(
            new EntifixBuildError(
              `command entity "${command.entity}" does not match "${SPECIFICATION_COLLECTION}"`,
            ),
          );
        }
        const entity = yield* deserialize(command);
        if (!entity.name) {
          return yield* Effect.fail(
            new EntifixBuildError('entity "name" is required'),
          );
        }
        yield* refuseSpecificationMedia(entity);
      }).pipe(Effect.mapError(toEngineError)),

    lockKeys: () => [`lock:code:${SEQUENCE}`],

    execute: command =>
      Effect.gen(function* () {
        const entity = yield* deserialize(command);
        const next = yield* sequence.next(SEQUENCE);
        entity.code = `${CODE_PREFIX}-${String(next).padStart(3, '0')}`;
        // The client's transaction id is the record's id: the idempotency key
        // and the address the browser is already watching.
        entity.id = command.transactionId;
        const outcome = { code: entity.code, entityId: entity.id };
        const document = {
          ...serializeEntity(ProductSpecification, entity),
          id: entity.id,
        };

        yield* units.forDatabase(db).run(unit =>
          Effect.tryPromise({
            try: () =>
              unit.handle.db
                .collection(SPECIFICATION_COLLECTION)
                .replaceOne({ id: entity.id }, document, {
                  upsert: true,
                  session: unit.handle.session,
                }),
            // A store fault, so the unit of work rolls back and surfaces it
            // rather than reading it as the body's own abort.
            catch: () => new Unavailable({ dependency: 'mongo' }),
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() =>
                unit.emit(completedEvent(command, outcome, source)),
              ),
            ),
          ),
        );
        return outcome;
      }).pipe(Effect.mapError(toEngineError)),

    rollback: command =>
      makeMongoRepository(db, ProductSpecification)
        .delete(command.transactionId)
        .pipe(
          Effect.provideService(ConfigurationRepositoryTag, configuration),
          Effect.asVoid,
          Effect.mapError(toEngineError),
        ),
  };
};

/**
 * The `202` create: accept the command now, finish it on a detached fiber,
 * and drain its announcement the moment it commits. A replayed command is
 * accepted again rather than refused — the client minted the id, so a retry
 * after a dropped response is the same request.
 */
export const MongoSpecificationCommandsLayer = Layer.effect(
  SpecificationCommandsTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const configuration = yield* ConfigurationRepositoryTag;
    const sequence = yield* SequenceServiceTag;
    const locks = yield* LockServiceTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;
    const units = makeMongoUnitsOfWork(client);

    return {
      accept: (organizationId, body) =>
        Effect.gen(function* () {
          const command = {
            ...(yield* readCommandEnvelope(body)),
            organizationId,
          };
          const db = yield* resolver.forOrganization(organizationId);
          yield* ensureOutboxIndexes(db);
          const outbox = makeMongoOutbox(db);
          const handler = specificationHandler(
            db,
            units,
            sequence,
            configuration,
            source,
          );
          const provided = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            effect.pipe(
              Effect.provideService(CommandTag, command),
              Effect.provideService(TransactionHandlerTag, handler),
              Effect.provideService(TransactionOutboxTag, outbox),
              Effect.provideService(LockServiceTag, locks),
              Effect.provideService(EventSourceTag, source),
            );

          const accepted = yield* provided(acceptTransaction());
          if (accepted.status === 'accepted') {
            yield* provided(completeTransaction(accepted.handles)).pipe(
              Effect.andThen(
                Effect.ignore(
                  drainOutbox(outbox, bus, {
                    maxAttempts,
                    database: db.databaseName,
                  }),
                ),
              ),
              Effect.forkDetach,
            );
          }
          return { transactionId: command.transactionId };
        }),
    };
  }),
);
