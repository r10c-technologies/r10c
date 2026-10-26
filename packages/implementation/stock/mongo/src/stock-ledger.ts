import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  deserializeSingleEntity,
  EntifixConnError,
  type Entity,
  type EntityConstructor,
  envelopeEntityName,
  serializeEntity,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  isDuplicateKey,
  makeMongoUnitsOfWork,
  type MongoUnit,
} from '@entifix/mongo/transactions';
import {
  type HoldOutcome,
  Reservation,
  type RestoreOutcome,
  StockItem,
  StockLedgerTag,
  StockMovement,
} from '@r10c/business-ts-stock-management';
import { Effect, Layer, Option } from 'effect';
import type { Db } from 'mongodb';

export const STOCK_ITEM_COLLECTION = envelopeEntityName(StockItem);
export const RESERVATION_COLLECTION = envelopeEntityName(Reservation);
export const MOVEMENT_COLLECTION = envelopeEntityName(StockMovement);

/** Holds expired per database per pass, so one pass stays bounded. */
const BATCH = 100;

/**
 * One counter per offering — the unique index the first-movement upsert rides,
 * so two first deliveries for a new offering make one item, not two.
 */
export const ensureStockItemIndexes = (db: Db) =>
  Effect.tryPromise({
    try: () =>
      db
        .collection(STOCK_ITEM_COLLECTION)
        .createIndex({ offeringId: 1 }, { unique: true, name: 'offeringId_1' }),
    catch: error =>
      new EntifixConnError('Failed to ensure the stock indexes', error, {
        database: db.databaseName,
      }),
  });

/** Not enough is free: the conditional take matched nothing. */
class Insufficient {
  readonly _tag = 'Insufficient';
}

/** A new offering's first counter raced another's into existence. */
class FirstCounterRaced {
  readonly _tag = 'FirstCounterRaced';
}

const failed =
  (message: string, details: Record<string, unknown>) => (error: unknown) =>
    new EntifixConnError(message, error, details);

/**
 * The `stock` store's ledger, one `stock_<organizationId>` database per call.
 *
 * Every write is one unit of work over the organization's own database:
 * counters move by `$inc`, a hold is a conditional take on what is free, and
 * a movement is appended beside the counter it moved.
 */
export const MongoStockLedgerLayer = Layer.effect(
  StockLedgerTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const directory = (yield* TenantDirectoryTag) as TenantDirectory<Db>;
    const units = makeMongoUnitsOfWork(client);
    const ensured = new Set<string>();

    /** The organization's database, its counter index ensured once. */
    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (!ensured.has(db.databaseName)) {
          yield* ensureStockItemIndexes(db);
          ensured.add(db.databaseName);
        }
        return db;
      });

    const revive = <T extends Entity>(
      entity: EntityConstructor<T>,
      record: unknown,
    ) =>
      Effect.map(
        deserializeSingleEntity(entity, record).pipe(
          Effect.mapError(failed('A stored record did not read back', {})),
        ),
        found => found as T,
      );

    /** Move one offering's counters, creating the item on its first movement. */
    const moveCounter = (unit: MongoUnit, offeringId: string, onHand: number) =>
      Effect.tryPromise({
        try: () =>
          unit.db.collection(STOCK_ITEM_COLLECTION).updateOne(
            { offeringId },
            {
              $inc: { onHand },
              $setOnInsert: {
                id: globalThis.crypto.randomUUID(),
                offeringId,
                reserved: 0,
              },
            },
            { upsert: true, session: unit.session },
          ),
        catch: error =>
          isDuplicateKey(error)
            ? new FirstCounterRaced()
            : failed('Failed to move the stock counter', { offeringId })(error),
      });

    const appendMovement = (unit: MongoUnit, movement: StockMovement) =>
      Effect.tryPromise({
        try: () =>
          unit.db
            .collection(MOVEMENT_COLLECTION)
            .insertOne(
              { ...serializeEntity(StockMovement, movement), id: movement.id },
              { session: unit.session },
            ),
        catch: failed('Failed to append the movement', {
          offeringId: movement.offeringId,
        }),
      });

    /**
     * A movement and its counter, once more if the item was created under it
     * by a sibling: the second attempt finds the item and simply increments.
     */
    const commitMovement = (
      db: Db,
      movement: StockMovement,
      commandId: string | undefined,
    ) =>
      units
        .forDatabase(db)
        .run(
          unit =>
            Effect.andThen(
              appendMovement(unit.handle, movement),
              moveCounter(unit.handle, movement.offeringId, movement.quantity),
            ).pipe(Effect.as(movement)),
          {
            ...(commandId === undefined
              ? {}
              : { claim: { kind: 'command' as const, commandId } }),
            replay: () => ({
              record: serializeEntity(StockMovement, movement),
            }),
          },
        )
        .pipe(
          Effect.flatMap(outcome =>
            outcome._tag === 'aborted'
              ? Effect.fail(outcome.reason)
              : Effect.succeed(outcome),
          ),
          Effect.retry({
            times: 1,
            while: error => error instanceof FirstCounterRaced,
          }),
          Effect.mapError(error =>
            error instanceof FirstCounterRaced
              ? new EntifixConnError(
                  'A first stock counter could not be created',
                  undefined,
                  {
                    offeringId: movement.offeringId,
                  },
                )
              : error,
          ),
        );

    /** What a duplicate command decided, or a failure when it remembers nothing. */
    const remembered = <T extends Entity>(
      db: Db,
      entity: EntityConstructor<T>,
      commandId: string,
    ) =>
      Effect.flatMap(units.forDatabase(db).replay(commandId), earlier =>
        Option.isNone(earlier)
          ? Effect.fail(
              new EntifixConnError(
                'A command was refused as a duplicate with no decision behind it',
                undefined,
                { commandId },
              ),
            )
          : revive(entity, (earlier.value as { record: unknown }).record),
      );

    const endHold = (
      db: Db,
      reservationId: string,
      to: 'released' | 'converted',
    ) =>
      Effect.gen(function* () {
        const held = (yield* Effect.tryPromise({
          try: () =>
            db
              .collection(RESERVATION_COLLECTION)
              .findOne(
                { id: reservationId, status: 'held' },
                { projection: { _id: 0, id: 1, offeringId: 1, quantity: 1 } },
              ),
          catch: failed('Failed to read the hold', { reservationId }),
        })) as { offeringId: string; quantity: number } | null;
        if (held === null) return 'not-held' as const;

        const outcome = yield* units.forDatabase(db).run(unit =>
          Effect.gen(function* () {
            // Conditional on `held` again: a conversion and an expiry racing
            // for one hold resolve to exactly one of the two.
            const moved = yield* Effect.tryPromise({
              try: () =>
                unit.handle.db
                  .collection(RESERVATION_COLLECTION)
                  .updateOne(
                    { id: reservationId, status: 'held' },
                    { $set: { status: to } },
                    { session: unit.handle.session },
                  ),
              catch: failed('Failed to end the hold', { reservationId }),
            });
            if (moved.matchedCount === 0) return 'not-held' as const;

            yield* Effect.tryPromise({
              try: () =>
                unit.handle.db
                  .collection(STOCK_ITEM_COLLECTION)
                  .updateOne(
                    { offeringId: held.offeringId },
                    { $inc: { reserved: -held.quantity } },
                    { session: unit.handle.session },
                  ),
              catch: failed('Failed to free the held quantity', {
                reservationId,
              }),
            });

            if (to === 'converted') {
              // A sale leaves the shelf: the ledger says so, and so does the counter.
              const sale = new StockMovement(
                held.offeringId,
                -held.quantity,
                'sale',
              );
              sale.id = globalThis.crypto.randomUUID();
              yield* appendMovement(unit.handle, sale);
              yield* Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(STOCK_ITEM_COLLECTION)
                    .updateOne(
                      { offeringId: held.offeringId },
                      { $inc: { onHand: -held.quantity } },
                      { session: unit.handle.session },
                    ),
                catch: failed('Failed to move the sold quantity', {
                  reservationId,
                }),
              });
            }
            return 'transitioned' as const;
          }),
        );
        // A unit with no claim commits or fails.
        return (outcome as { readonly value: 'transitioned' | 'not-held' })
          .value;
      });

    return {
      take: (organizationId, reservation, commandId) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.gen(function* () {
                const taken = yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db.collection(STOCK_ITEM_COLLECTION).updateOne(
                      {
                        offeringId: reservation.offeringId,
                        $expr: {
                          $gte: [
                            { $subtract: ['$onHand', '$reserved'] },
                            reservation.quantity,
                          ],
                        },
                      },
                      { $inc: { reserved: reservation.quantity } },
                      { session: unit.handle.session },
                    ),
                  catch: failed('Failed to take the hold', {
                    offeringId: reservation.offeringId,
                  }),
                });
                if (taken.matchedCount === 0)
                  return yield* Effect.fail(new Insufficient());
                yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db.collection(RESERVATION_COLLECTION).insertOne(
                      {
                        ...serializeEntity(Reservation, reservation),
                        id: reservation.id,
                      },
                      { session: unit.handle.session },
                    ),
                  catch: failed('Failed to record the hold', {
                    offeringId: reservation.offeringId,
                  }),
                });
                return reservation;
              }),
            {
              ...(commandId === undefined
                ? {}
                : { claim: { kind: 'command' as const, commandId } }),
              replay: () => ({
                record: serializeEntity(Reservation, reservation),
              }),
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'held', reservation } as HoldOutcome;
          }
          if (outcome._tag === 'aborted')
            return { _tag: 'insufficient' } as HoldOutcome;
          return {
            _tag: 'replayed',
            reservation: yield* remembered(
              db,
              Reservation,
              commandId as string,
            ),
          } as HoldOutcome;
        }),

      end: (organizationId, reservationId, to) =>
        Effect.flatMap(databaseOf(organizationId), db =>
          endHold(db, reservationId, to),
        ),

      record: (organizationId, movement) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          yield* commitMovement(db, movement, undefined);
          return movement;
        }),

      restore: (organizationId, movement, commandId) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const outcome = yield* commitMovement(db, movement, commandId);
          if (outcome._tag === 'committed') {
            return { _tag: 'restored', movement } as RestoreOutcome;
          }
          return {
            _tag: 'replayed',
            movement: yield* remembered(db, StockMovement, commandId as string),
          } as RestoreOutcome;
        }),

      releaseExpired: () =>
        Effect.gen(function* () {
          let released = 0;
          for (const { handle: db } of yield* directory.list()) {
            const expired = yield* Effect.tryPromise({
              try: () =>
                db
                  .collection(RESERVATION_COLLECTION)
                  .find(
                    // A Date, never its ISO string: `take` stores the
                    // entity's `Date`, and Mongo never orders a string against
                    // a date, so a string bound matched no hold at all.
                    { status: 'held', expiresAt: { $lt: new Date() } },
                    { projection: { _id: 0, id: 1 }, limit: BATCH },
                  )
                  .toArray(),
              catch: failed('Failed to read the expired holds', {
                database: db.databaseName,
              }),
            });
            for (const { id } of expired as unknown as ReadonlyArray<{
              id: string;
            }>) {
              // Each hold on its own: one that fails must not keep the rest
              // promised forever.
              const outcome = yield* endHold(db, id, 'released').pipe(
                Effect.catch(error =>
                  Effect.as(
                    Effect.logError('expiring a reservation failed').pipe(
                      Effect.annotateLogs({
                        database: db.databaseName,
                        reservationId: id,
                        error: String(error),
                      }),
                    ),
                    'not-held' as const,
                  ),
                ),
              );
              if (outcome === 'transitioned') released += 1;
            }
          }
          return released;
        }),
    };
  }),
);
