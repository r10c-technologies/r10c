import {
  deserializeSingleEntity,
  type DomainEvent,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  MongoUnitOfWorkTag,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  type CancellationClaim,
  type OrderItem,
  type OrderPlacement,
  ProductOrder,
  ProductOrderStoreTag,
} from '@r10c/business-ts-order-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const ORDER_COLLECTION = envelopeEntityName(ProductOrder);

const WITHOUT_ID = { projection: { _id: 0 } } as const;

/**
 * The indexes every scoped read rides: each read of this store is narrowed
 * by a predicate rather than by a handle, so without them a scope is a
 * collection scan.
 */
export const ensureProductOrderIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const collection = db.collection(ORDER_COLLECTION);
      await collection.createIndex(
        { buyerId: 1, placedAt: -1 },
        { name: 'buyerId_1_placedAt_-1' },
      );
      await collection.createIndex(
        { 'items.vendorId': 1, placedAt: -1 },
        { name: 'items.vendorId_1_placedAt_-1' },
      );
    },
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/** An order did not move: its status was not the one the transition leaves. */
class NotClaimable {
  readonly _tag = 'NotClaimable';
}

/**
 * The `order` store over one named database. Every transition is a
 * conditional write on the status it leaves; placing and settling a
 * cancellation announce themselves in the same unit, and drain the moment it
 * commits.
 */
export const MongoProductOrderStoreLayer = Layer.effect(
  ProductOrderStoreTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const units = yield* MongoUnitOfWorkTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;
    const orders = db.collection(ORDER_COLLECTION);

    yield* ensureProductOrderIndexes(db);

    const afterCommit = drainOutboxNow(db).pipe(
      Effect.provideService(EventBusTag, bus),
      Effect.provideService(OutboxMaxAttempts, maxAttempts),
    );

    const revive = (document: unknown) =>
      deserializeSingleEntity(ProductOrder, document).pipe(
        Effect.mapError(() => new Unavailable({ dependency: 'mongo' })),
      );

    const reviveOrNone = (document: unknown) =>
      document === null || document === undefined
        ? Effect.succeed(undefined)
        : revive(document);

    const event = (name: string, id: string, data: unknown): DomainEvent => ({
      name,
      id: `${id}:${name.split('.')[1] as string}`,
      source,
      at: new Date().toISOString(),
      correlationId: id,
      data,
    });

    /** `from → to` on one order, inside a unit's session. */
    const move = (
      session: ClientSession,
      orderId: string,
      from: string,
      to: string,
    ) =>
      Effect.tryPromise({
        try: () =>
          orders.findOneAndUpdate(
            { id: orderId, status: from },
            { $set: { status: to } },
            { returnDocument: 'after', ...WITHOUT_ID, session },
          ),
        catch: storeUnavailable,
      });

    const claimFor = (commandId: string | undefined) =>
      commandId === undefined
        ? {}
        : { claim: { kind: 'command' as const, commandId } };

    return {
      get: orderId =>
        Effect.tryPromise({
          try: () => orders.findOne({ id: orderId }, WITHOUT_ID),
          catch: storeUnavailable,
        }).pipe(Effect.flatMap(reviveOrNone)),

      place: (order, commandId) =>
        Effect.gen(function* () {
          const orderId = String(order.id);
          const document = {
            ...serializeEntity(ProductOrder, order),
            id: orderId,
          };
          const placed = event(
            'order.placed',
            orderId,
            serializeEntity(ProductOrder, order),
          );
          const outcome = yield* units.run(
            unit =>
              Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(ORDER_COLLECTION)
                    .insertOne(document, { session: unit.handle.session }),
                catch: storeUnavailable,
              }).pipe(Effect.tap(() => Effect.sync(() => unit.emit(placed)))),
            {
              ...claimFor(commandId),
              replay: () => ({ record: serializeEntity(ProductOrder, order) }),
              afterCommit,
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'placed', order } as OrderPlacement;
          }
          const remembered = yield* units.replay(commandId as string);
          // Every claim this store takes remembers its order; a duplicate with
          // none is a collision, never a replay.
          if (Option.isNone(remembered)) {
            return yield* Effect.fail(new Unavailable({ dependency: 'mongo' }));
          }
          return {
            _tag: 'replayed',
            order: yield* revive(
              (remembered.value as { record: unknown }).record,
            ),
          } as OrderPlacement;
        }),

      remove: orderId =>
        Effect.tryPromise({
          try: () => orders.deleteOne({ id: orderId }),
          catch: storeUnavailable,
        }).pipe(Effect.map(result => result.deletedCount > 0)),

      fulfil: (orderId, items, status) =>
        Effect.tryPromise({
          try: () =>
            orders.findOneAndUpdate(
              { id: orderId, status: 'paid' },
              {
                $set: {
                  items: serializeEntity(
                    ProductOrder,
                    Object.assign(new ProductOrder(), {
                      items: items as OrderItem[],
                    }),
                  )['items'],
                  status,
                },
              },
              { returnDocument: 'after', ...WITHOUT_ID },
            ),
          catch: storeUnavailable,
        }).pipe(Effect.flatMap(reviveOrNone)),

      claimCancellation: (orderId, commandId) =>
        Effect.gen(function* () {
          const outcome = yield* units.run(
            unit =>
              Effect.flatMap(
                move(unit.handle.session, orderId, 'paid', 'cancelling'),
                updated =>
                  updated === null
                    ? Effect.fail(new NotClaimable())
                    : Effect.succeed(updated),
              ),
            claimFor(commandId),
          );
          if (outcome._tag === 'committed') {
            return {
              _tag: 'claimed',
              order: yield* revive(outcome.value),
            } as CancellationClaim;
          }
          return (
            outcome._tag === 'duplicate'
              ? { _tag: 'replayed' }
              : { _tag: 'notClaimable' }
          ) as CancellationClaim;
        }),

      releaseCancellation: orderId =>
        Effect.tryPromise({
          try: () =>
            orders.findOneAndUpdate(
              { id: orderId, status: 'cancelling' },
              { $set: { status: 'paid' } },
              { returnDocument: 'after', ...WITHOUT_ID },
            ),
          catch: storeUnavailable,
        }).pipe(Effect.map(released => released !== null)),

      settleCancellation: (orderId, commandId) =>
        Effect.gen(function* () {
          const outcome = yield* units.run(
            unit =>
              Effect.flatMap(
                move(unit.handle.session, orderId, 'cancelling', 'cancelled'),
                updated => {
                  if (updated === null) return Effect.fail(new NotClaimable());
                  unit.emit(event('order.cancelled', orderId, updated));
                  return Effect.succeed(updated);
                },
              ),
            { ...claimFor(commandId), afterCommit },
          );
          return outcome._tag === 'committed'
            ? yield* revive(outcome.value)
            : undefined;
        }),

      markPaid: (claim, orderId, paidAt) =>
        Effect.map(
          units.run(
            unit =>
              Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(ORDER_COLLECTION)
                    .updateOne(
                      { id: orderId, status: 'pending' },
                      { $set: { status: 'paid', paidAt } },
                      { session: unit.handle.session },
                    ),
                catch: storeUnavailable,
              }),
            { claim: { kind: 'event', ...claim } },
          ),
          outcome => (outcome._tag === 'duplicate' ? 'duplicate' : 'claimed'),
        ),
    };
  }),
);
