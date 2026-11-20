import {
  type TenantDatabaseResolver,
  TenantDatabaseResolverTag,
  type TenantDirectory,
  TenantDirectoryTag,
} from '@entifix/business';
import {
  deserializeSingleEntity,
  envelopeEntityName,
  NotFound,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  COMMAND_INBOX_COLLECTION,
  drainOutboxNow,
  ensureOutboxIndexes,
  makeMongoUnitsOfWork,
  mongoUnitFault,
} from '@entifix/mongo/transactions';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  CLOSED_AT,
  type DestinationRedaction,
  EVENT_OF,
  type OpenOutcome,
  type ParcelInTransit,
  ShippingOrder,
  shippingOrderEvent,
  ShippingOrderNotTransitionable,
  ShippingOrderStoreTag,
  shippingStatusAfter,
  ShippingStatuses,
  STAMP_OF,
} from '@r10c/business-ts-shipping-order-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const SHIPPING_ORDER_COLLECTION = envelopeEntityName(ShippingOrder);

const WITHOUT_ID = { projection: { _id: 0 } } as const;

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/** How many closed shipments one retention pass takes per organization. */
const BATCH = 100;

/**
 * Removes the destination from the record each command claim that opened
 * `orderId` remembered for a redelivery, so the address leaves the store and
 * not only the shipment. Rewritten whole rather than `$unset` on a dotted
 * path, one claim at a time, inside the caller's unit.
 */
const forgetRememberedDestination = async (
  db: Db,
  session: ClientSession,
  orderId: string,
) => {
  const inbox = db.collection(COMMAND_INBOX_COLLECTION);
  const remembered = await inbox
    .find(
      { 'replay.record.orderId': orderId },
      { projection: { _id: 0, commandId: 1, replay: 1 }, session },
    )
    .toArray();
  for (const { commandId, replay } of remembered) {
    const { record, ...rest } = replay as { record: Record<string, unknown> };
    const kept = Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== 'destination'),
    );
    await inbox.updateOne(
      { commandId },
      { $set: { replay: { ...rest, record: kept } } },
      { session },
    );
  }
};

/** The move did not land: the shipment stood where the move is not legal. */
class NotMoved {
  readonly _tag = 'NotMoved';
}

/**
 * One shipment per vendor order — the index an opening's redelivery under a
 * new command would otherwise slip past — and the vendor's worklist by status.
 */
export const ensureShippingOrderIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const shipments = db.collection(SHIPPING_ORDER_COLLECTION);
      await shipments.createIndex(
        { orderId: 1 },
        { unique: true, name: 'orderId_1' },
      );
      await shipments.createIndex({ status: 1 }, { name: 'status_1' });
    },
    catch: storeUnavailable,
  });

/**
 * The `fulfilment` store, one `fulfilment_<organizationId>` database per call.
 *
 * ⚠️ **Every move is one conditional write** on each status it is legal from,
 * tried in turn — so a dispatch and a hold racing on one shipment leave exactly
 * one winner, and the loser finds nothing to match. A move past dispatch
 * announces itself into the organization's own outbox in the same unit, drained
 * the moment it commits, for the delivery flow that waits on it (ADR 0070).
 */
export const MongoShippingOrderStoreLayer = Layer.effect(
  ShippingOrderStoreTag,
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

    /** The organization's database, its indexes and outbox ensured once. */
    const databaseOf = (organizationId: string) =>
      Effect.gen(function* () {
        const db = yield* resolver.forOrganization(organizationId);
        if (!ensured.has(db.databaseName)) {
          yield* ensureShippingOrderIndexes(db);
          yield* ensureOutboxIndexes(db);
          ensured.add(db.databaseName);
        }
        return db;
      });

    const revive = (record: unknown) =>
      Effect.map(
        deserializeSingleEntity(ShippingOrder, record).pipe(
          Effect.mapError(storeUnavailable),
        ),
        found => found as ShippingOrder,
      );

    const read = (db: Db, id: string) =>
      Effect.tryPromise({
        try: () =>
          db.collection(SHIPPING_ORDER_COLLECTION).findOne({ id }, WITHOUT_ID),
        catch: storeUnavailable,
      }).pipe(
        Effect.flatMap(found =>
          found === null ? Effect.succeed(undefined) : revive(found),
        ),
      );

    const claimFor = (commandId: string | undefined) =>
      commandId === undefined
        ? {}
        : { claim: { kind: 'command' as const, commandId } };

    return {
      get: (organizationId, id) =>
        Effect.flatMap(databaseOf(organizationId), db => read(db, id)),

      open: (organizationId, order, commandId) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const opened = Object.assign(order, { status: 'awaiting-dispatch' });
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(SHIPPING_ORDER_COLLECTION)
                    .insertOne(
                      {
                        ...serializeEntity(ShippingOrder, opened),
                        id: opened.id,
                      },
                      { session: unit.handle.session },
                    ),
                catch: mongoUnitFault,
              }),
            {
              ...claimFor(commandId),
              replay: () => ({
                record: serializeEntity(ShippingOrder, opened),
              }),
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'opened', order: opened } as OpenOutcome;
          }
          const remembered = yield* units
            .forDatabase(db)
            .replay(commandId as string);
          // Every claim this store takes remembers its shipment; a duplicate
          // with none is a collision, never a replay.
          if (Option.isNone(remembered)) {
            return yield* Effect.fail(storeUnavailable());
          }
          return {
            _tag: 'replayed',
            order: yield* revive(
              (remembered.value as { record: unknown }).record,
            ),
          } as OpenOutcome;
        }),

      transition: (organizationId, id, transition, at, commandId) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const stamp = STAMP_OF[transition];
          const announces = EVENT_OF[transition];
          const outcome = yield* units.forDatabase(db).run(
            unit =>
              Effect.gen(function* () {
                for (const from of ShippingStatuses) {
                  const to = shippingStatusAfter(from, transition);
                  if (to === undefined) continue;
                  const moved = yield* Effect.tryPromise({
                    try: () =>
                      unit.handle.db
                        .collection(SHIPPING_ORDER_COLLECTION)
                        .findOneAndUpdate(
                          { id, status: from },
                          {
                            $set: {
                              status: to,
                              ...(stamp === undefined ? {} : { [stamp]: at }),
                            },
                          },
                          {
                            returnDocument: 'after',
                            ...WITHOUT_ID,
                            session: unit.handle.session,
                          },
                        ),
                    catch: mongoUnitFault,
                  });
                  if (moved === null) continue;
                  if (announces !== undefined) {
                    unit.emit(
                      shippingOrderEvent(
                        announces,
                        organizationId,
                        moved as unknown as Record<string, unknown> & {
                          id: string;
                        },
                        source,
                      ),
                    );
                  }
                  return moved;
                }
                return yield* Effect.fail(new NotMoved());
              }),
            {
              ...claimFor(commandId),
              afterCommit: drainOutboxNow(db).pipe(
                Effect.provideService(EventBusTag, bus),
                Effect.provideService(OutboxMaxAttempts, maxAttempts),
              ),
            },
          );
          if (outcome._tag === 'committed') return yield* revive(outcome.value);
          const current = yield* read(db, id);
          if (current === undefined) {
            return yield* new NotFound({ entity: 'shipping-order' });
          }
          // A repeated command answers the shipment as it stands.
          if (outcome._tag === 'duplicate') return current;
          return yield* new ShippingOrderNotTransitionable({
            shippingOrderId: id,
            standing: current.status,
            transition,
          });
        }),

      // ADR 0081 §11. Conditional on the status the guide is legal in, so a
      // dispatch or a hold that landed first leaves nothing to match. Not a
      // move, so it claims no command and announces nothing: the guide
      // reaches the buyer with the dispatch that carries it.
      recordGuide: (organizationId, id, guide, at) =>
        Effect.gen(function* () {
          const db = yield* databaseOf(organizationId);
          const recorded = yield* Effect.tryPromise({
            try: () =>
              db
                .collection(SHIPPING_ORDER_COLLECTION)
                .findOneAndUpdate(
                  { id, status: 'awaiting-dispatch' },
                  { $set: { ...guide, guideRecordedAt: at } },
                  { returnDocument: 'after', ...WITHOUT_ID },
                ),
            catch: storeUnavailable,
          });
          return recorded === null ? undefined : yield* revive(recorded);
        }),

      // What the courier feed is asked about: every organization's dispatched
      // parcels, oldest first, until `limit`.
      inTransit: limit =>
        Effect.gen(function* () {
          const parcels: ParcelInTransit[] = [];
          for (const {
            organizationId,
            handle: db,
          } of yield* directory.list()) {
            const room = limit - parcels.length;
            if (room <= 0) break;
            const rows = yield* Effect.tryPromise({
              try: () =>
                db
                  .collection(SHIPPING_ORDER_COLLECTION)
                  .find(
                    { status: 'dispatched' },
                    {
                      projection: {
                        _id: 0,
                        id: 1,
                        courierKey: 1,
                        trackingNumber: 1,
                        dispatchedAt: 1,
                      },
                    },
                  )
                  .sort({ dispatchedAt: 1 })
                  .limit(room)
                  .toArray(),
              catch: storeUnavailable,
            });
            for (const row of rows) {
              parcels.push({
                organizationId,
                shippingOrderId: String(row['id']),
                courierKey: String(row['courierKey'] ?? ''),
                trackingNumber: String(row['trackingNumber'] ?? ''),
                dispatchedAt: new Date(row['dispatchedAt'] as Date),
              });
            }
          }
          return parcels;
        }),

      // ADR 0076 §4. A `Date` bound, never its ISO string: the stamps are
      // stored as dates. Each shipment in a unit of its own, so its address
      // and the copy its opening remembered leave together, and one that
      // fails is reported while the rest still go.
      redactClosedBefore: (before, at) =>
        Effect.gen(function* () {
          let redacted = 0;
          const failed: Array<DestinationRedaction['failed'][number]> = [];
          for (const { handle: db } of yield* directory.list()) {
            const closed = Object.entries(CLOSED_AT).map(([status, stamp]) => ({
              status,
              [stamp]: { $lt: before },
            }));
            const due = yield* Effect.tryPromise({
              try: () =>
                db
                  .collection(SHIPPING_ORDER_COLLECTION)
                  .find(
                    {
                      'destination.phone': { $exists: true },
                      $or: closed,
                    },
                    { projection: { _id: 0, id: 1, orderId: 1 }, limit: BATCH },
                  )
                  .toArray(),
              catch: storeUnavailable,
            });
            for (const { id, orderId } of due as unknown as ReadonlyArray<{
              id: string;
              orderId: string;
            }>) {
              yield* units
                .forDatabase(db)
                .run(unit =>
                  Effect.tryPromise({
                    try: async () => {
                      const session = unit.handle.session;
                      await unit.handle.db
                        .collection(SHIPPING_ORDER_COLLECTION)
                        .updateOne(
                          { id },
                          {
                            $unset: { destination: '' },
                            $set: { redactedAt: at },
                          },
                          { session },
                        );
                      await forgetRememberedDestination(
                        unit.handle.db,
                        session,
                        orderId,
                      );
                    },
                    catch: mongoUnitFault,
                  }),
                )
                .pipe(
                  Effect.match({
                    onSuccess: () => {
                      redacted += 1;
                    },
                    onFailure: failure => {
                      failed.push({
                        database: db.databaseName,
                        shippingOrderId: id,
                        failure,
                      });
                    },
                  }),
                );
            }
          }
          return { redacted, failed } as DestinationRedaction;
        }),
    };
  }),
);
