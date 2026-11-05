import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  ensureOutboxIndexes,
  isDuplicateKey,
  makeMongoUnitsOfWork,
  type MongoUnit,
  mongoUnitFault,
} from '@entifix/mongo/transactions';
import type { OutboxEvent } from '@entifix/transactions';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  type ExpirySweep,
  type HoldOutcome,
  InsufficientStock,
  Reservation,
  type RestoreOutcome,
  StockItem,
  stockItemChangedEvent,
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
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });

/** Not enough is free: the conditional take matched nothing. */
class Insufficient {
  readonly _tag = 'Insufficient';
}

/** A new offering's first counter raced another's into existence. */
class FirstCounterRaced {
  readonly _tag = 'FirstCounterRaced';
}

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/** The emit half of a unit: what a counter's change is announced through. */
type Emitting = { readonly emit: (event: OutboxEvent) => void };

/**
 * The `stock` store's ledger, one `stock_<organizationId>` database per call.
 *
 * Every write is one unit of work over the organization's own database:
 * counters move by `$inc`, a hold is a conditional take on what is free, and
 * a movement is appended beside the counter it moved.
 *
 * ⚠️ **Every counter move announces itself in the same unit.** It bumps the
 * item's `version` with the same `$inc` and emits `stock-item.changed` at that
 * version into the database's own outbox, drained the moment the unit commits
 * — so availability can be pushed, and a consumer orders two changes to one
 * item by the version rather than by arrival (ADR 0068).
 */
export const MongoStockLedgerLayer = Layer.effect(
  StockLedgerTag,
  Effect.gen(function* () {
    const client = yield* MongoClientTag;
    const resolver =
      (yield* TenantDatabaseResolverTag) as TenantDatabaseResolver<Db>;
    const directory = (yield* TenantDirectoryTag) as TenantDirectory<Db>;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;
    const units = makeMongoUnitsOfWork(client);
    const ensured = new Set<string>();

    /** The organization's database, its counter and outbox indexes ensured once. */
    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (!ensured.has(db.databaseName)) {
          yield* ensureStockItemIndexes(db);
          yield* ensureOutboxIndexes(db);
          ensured.add(db.databaseName);
        }
        return db;
      });

    const drained = (db: Db) =>
      drainOutboxNow(db).pipe(
        Effect.provideService(EventBusTag, bus),
        Effect.provideService(OutboxMaxAttempts, maxAttempts),
      );

    /**
     * Move one item's counters by `inc`, where `filter` still matches, bumping
     * its version and announcing the change in the same unit; `null` when the
     * filter matched nothing.
     */
    const change = (
      unit: MongoUnit,
      emitter: Emitting,
      organizationId: string,
      filter: Record<string, unknown>,
      inc: Record<string, number>,
      upsert: Record<string, unknown> | undefined,
    ) =>
      Effect.tryPromise({
        try: () =>
          unit.db.collection(STOCK_ITEM_COLLECTION).findOneAndUpdate(
            filter,
            {
              $inc: { ...inc, version: 1 },
              ...(upsert === undefined ? {} : { $setOnInsert: upsert }),
            },
            {
              upsert: upsert !== undefined,
              returnDocument: 'after',
              projection: { _id: 0 },
              session: unit.session,
            },
          ),
        catch: error =>
          isDuplicateKey(error)
            ? new FirstCounterRaced()
            : mongoUnitFault(error),
      }).pipe(
        Effect.map(item => {
          if (item !== null) {
            emitter.emit(
              stockItemChangedEvent(
                organizationId,
                {
                  id: String(item['id']),
                  offeringId: String(item['offeringId']),
                  onHand: Number(item['onHand']),
                  reserved: Number(item['reserved']),
                  version: Number(item['version']),
                },
                source,
              ),
            );
          }
          return item;
        }),
      );

    const revive = <T extends Entity>(
      entity: EntityConstructor<T>,
      record: unknown,
    ) =>
      Effect.map(
        deserializeSingleEntity(entity, record).pipe(
          Effect.mapError(storeUnavailable),
        ),
        found => found as T,
      );

    /** Move one offering's counters, creating the item on its first movement. */
    const moveCounter = (
      unit: MongoUnit,
      emitter: Emitting,
      organizationId: string,
      offeringId: string,
      onHand: number,
    ) =>
      change(
        unit,
        emitter,
        organizationId,
        { offeringId },
        { onHand },
        { id: globalThis.crypto.randomUUID(), offeringId, reserved: 0 },
      );

    const appendMovement = (unit: MongoUnit, movement: StockMovement) =>
      Effect.tryPromise({
        try: () =>
          unit.db
            .collection(MOVEMENT_COLLECTION)
            .insertOne(
              { ...serializeEntity(StockMovement, movement), id: movement.id },
              { session: unit.session },
            ),
        catch: mongoUnitFault,
      });

    /**
     * A movement and its counter, once more if the item was created under it
     * by a sibling: the second attempt finds the item and simply increments.
     */
    const commitMovement = (
      db: Db,
      organizationId: string,
      movement: StockMovement,
      commandId: string | undefined,
    ) =>
      units
        .forDatabase(db)
        .run(
          unit =>
            Effect.andThen(
              appendMovement(unit.handle, movement),
              moveCounter(
                unit.handle,
                unit,
                organizationId,
                movement.offeringId,
                movement.quantity,
              ),
            ).pipe(Effect.as(movement)),
          {
            ...(commandId === undefined
              ? {}
              : { claim: { kind: 'command' as const, commandId } }),
            replay: () => ({
              record: serializeEntity(StockMovement, movement),
            }),
            afterCommit: drained(db),
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
              ? new Unavailable({ dependency: 'mongo' })
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
          ? Effect.fail(new Unavailable({ dependency: 'mongo' }))
          : revive(entity, (earlier.value as { record: unknown }).record),
      );

    const endHold = (
      db: Db,
      organizationId: string,
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
          catch: storeUnavailable,
        })) as { offeringId: string; quantity: number } | null;
        if (held === null) return 'not-held' as const;

        const outcome = yield* units.forDatabase(db).run(
          unit =>
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
                catch: mongoUnitFault,
              });
              if (moved.matchedCount === 0) return 'not-held' as const;

              if (to === 'converted') {
                // A sale leaves the shelf: the ledger says so, and so does the
                // counter, in the one change that also gives the hold back.
                const sale = new StockMovement(
                  held.offeringId,
                  -held.quantity,
                  'sale',
                );
                sale.id = globalThis.crypto.randomUUID();
                yield* appendMovement(unit.handle, sale);
              }
              yield* change(
                unit.handle,
                unit,
                organizationId,
                { offeringId: held.offeringId },
                to === 'converted'
                  ? { reserved: -held.quantity, onHand: -held.quantity }
                  : { reserved: -held.quantity },
                undefined,
              );
              return 'transitioned' as const;
            }),
          { afterCommit: drained(db) },
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
                const taken = yield* change(
                  unit.handle,
                  unit,
                  organizationId,
                  {
                    offeringId: reservation.offeringId,
                    $expr: {
                      $gte: [
                        { $subtract: ['$onHand', '$reserved'] },
                        reservation.quantity,
                      ],
                    },
                  },
                  { reserved: reservation.quantity },
                  undefined,
                );
                if (taken === null)
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
                  catch: mongoUnitFault,
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
              afterCommit: drained(db),
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'held', reservation } as HoldOutcome;
          }
          if (outcome._tag === 'aborted') {
            // What is free now, read after the refusal: a hint for the caller,
            // which the next hold may already have moved.
            const item = yield* Effect.tryPromise({
              try: () =>
                db
                  .collection(STOCK_ITEM_COLLECTION)
                  .findOne({ offeringId: reservation.offeringId }),
              catch: storeUnavailable,
            });
            return yield* Effect.fail(
              new InsufficientStock({
                offeringId: reservation.offeringId,
                requested: reservation.quantity,
                available: Math.max(
                  0,
                  Number(item?.['onHand'] ?? 0) -
                    Number(item?.['reserved'] ?? 0),
                ),
              }),
            );
          }
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
          endHold(db, organizationId, reservationId, to),
        ),

      record: (organizationId, movement) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          yield* commitMovement(db, organizationId, movement, undefined);
          return movement;
        }),

      restore: (organizationId, movement, commandId) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const outcome = yield* commitMovement(
            db,
            organizationId,
            movement,
            commandId,
          );
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
          const failed: Array<ExpirySweep['failed'][number]> = [];
          for (const {
            handle: db,
            organizationId,
          } of yield* directory.list()) {
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
              catch: storeUnavailable,
            });
            for (const { id } of expired as unknown as ReadonlyArray<{
              id: string;
            }>) {
              // Each hold on its own: one that fails must not keep the rest
              // promised forever.
              const outcome = yield* endHold(
                db,
                organizationId,
                id,
                'released',
              ).pipe(
                Effect.catch(failure => {
                  failed.push({
                    database: db.databaseName,
                    reservationId: id,
                    failure,
                  });
                  return Effect.succeed('not-held' as const);
                }),
              );
              if (outcome === 'transitioned') released += 1;
            }
          }
          return { released, failed } as ExpirySweep;
        }),
    };
  }),
);
