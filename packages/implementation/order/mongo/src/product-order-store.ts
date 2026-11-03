import {
  deserializeSingleEntity,
  envelopeEntityName,
  NotFound,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  MongoUnitOfWorkTag,
} from '@entifix/mongo/transactions';
import {
  EventBusTag,
  EventSourceTag,
  type OutboxEvent,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  ORDER_CANCELLED,
  ORDER_PLACED,
  orderAudience,
} from '@r10c/business-ts-order-contracts';
import {
  type CancellationClaim,
  CheckoutGroup,
  CheckoutGroupStoreTag,
  type GroupOpening,
  type OrderPlacement,
  orderStatusAfter,
  ProductOrder,
  ProductOrderStoreTag,
  statusesBefore,
} from '@r10c/business-ts-order-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const ORDER_COLLECTION = envelopeEntityName(ProductOrder);
export const GROUP_COLLECTION = envelopeEntityName(CheckoutGroup);

/** The members of a serialized order an event's audience is read from. */
type SerializedOrder = Record<string, unknown> & {
  readonly buyerId?: string;
  readonly vendorId?: string;
};

const WITHOUT_ID = { projection: { _id: 0 } } as const;

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/**
 * The indexes every scoped read rides: each read of this store is narrowed by
 * a predicate rather than by a handle, so without them a scope is a collection
 * scan. A vendor's list is a top-level `vendorId` now, and a group's orders are
 * read by `groupId` (ADR 0069).
 */
export const ensureProductOrderIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      const orders = db.collection(ORDER_COLLECTION);
      await orders.createIndex(
        { buyerId: 1, placedAt: -1 },
        { name: 'buyerId_1_placedAt_-1' },
      );
      await orders.createIndex(
        { vendorId: 1, placedAt: -1 },
        { name: 'vendorId_1_placedAt_-1' },
      );
      await orders.createIndex({ groupId: 1 }, { name: 'groupId_1' });
      await db
        .collection(GROUP_COLLECTION)
        .createIndex(
          { buyerId: 1, placedAt: -1 },
          { name: 'buyerId_1_placedAt_-1' },
        );
    },
    catch: storeUnavailable,
  });

/** An order did not move: its status was not one the transition leaves. */
class NotMoved {
  readonly _tag = 'NotMoved';
}

/**
 * The `order` store over one named database: its vendor orders and the
 * checkout groups they were placed in. Every transition is a conditional write
 * on the statuses it is legal from; placing, and every move that ends an order
 * cancelled, announce themselves in the same unit, and drain the moment it
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
        Effect.mapError(storeUnavailable),
      );

    const reviveOrNone = (document: unknown) =>
      document === null || document === undefined
        ? Effect.succeed(undefined)
        : revive(document);

    // A vendor order's announced lifecycle is linear — placed, then possibly
    // cancelled — so each event is a fixed version of its order.
    const VERSION: Record<
      typeof ORDER_PLACED | typeof ORDER_CANCELLED,
      number
    > = {
      [ORDER_PLACED]: 1,
      [ORDER_CANCELLED]: 2,
    };
    const event = (
      name: typeof ORDER_PLACED | typeof ORDER_CANCELLED,
      id: string,
      data: SerializedOrder,
    ): OutboxEvent => ({
      name,
      id: `${id}:${name.split('.')[1] as string}`,
      source,
      at: new Date().toISOString(),
      correlationId: id,
      aggregate: { type: 'product-order', id },
      version: VERSION[name],
      audience: orderAudience(data),
      data,
    });

    /** `from → to` on one order, inside a unit's session. */
    const shift = (
      session: ClientSession,
      handle: Db,
      orderId: string,
      from: readonly string[],
      set: Record<string, unknown>,
    ) =>
      Effect.tryPromise({
        try: () =>
          handle
            .collection(ORDER_COLLECTION)
            .findOneAndUpdate(
              { id: orderId, status: { $in: [...from] } },
              { $set: set },
              { returnDocument: 'after', ...WITHOUT_ID, session },
            ),
        catch: storeUnavailable,
      });

    const claimFor = (commandId: string | undefined) =>
      commandId === undefined
        ? {}
        : { claim: { kind: 'command' as const, commandId } };

    /** An order as it stands, for a command that already ran. */
    const current = (orderId: string) =>
      Effect.tryPromise({
        try: () => orders.findOne({ id: orderId }, WITHOUT_ID),
        catch: storeUnavailable,
      }).pipe(Effect.flatMap(reviveOrNone));

    return {
      get: current,

      forGroup: groupId =>
        Effect.tryPromise({
          try: () => orders.find({ groupId }, WITHOUT_ID).toArray(),
          catch: storeUnavailable,
        }).pipe(
          Effect.flatMap(
            documents =>
              Effect.forEach(documents, revive) as Effect.Effect<
                ProductOrder[],
                Unavailable
              >,
          ),
        ),

      place: (order, commandId) =>
        Effect.gen(function* () {
          const orderId = String(order.id);
          const document = {
            ...serializeEntity(ProductOrder, order),
            id: orderId,
          };
          const placed = event(
            ORDER_PLACED,
            orderId,
            serializeEntity(ProductOrder, order),
          );
          const outcome = yield* units.run(
            unit =>
              Effect.gen(function* () {
                const { db: handle, session } = unit.handle;
                // The order joins its group with an atomic `$addToSet`, so the
                // vendors' concurrent writes into one group never lose each
                // other; a group nobody opened refuses the order rather than
                // leaving it orphaned.
                const joined = yield* Effect.tryPromise({
                  try: () =>
                    handle
                      .collection(GROUP_COLLECTION)
                      .updateOne(
                        { id: order.groupId },
                        { $addToSet: { orderIds: orderId } },
                        { session },
                      ),
                  catch: storeUnavailable,
                });
                if (joined.matchedCount === 0) {
                  return yield* Effect.fail(
                    new NotFound({ entity: 'checkout-group' }),
                  );
                }
                yield* Effect.tryPromise({
                  try: () =>
                    handle
                      .collection(ORDER_COLLECTION)
                      .insertOne(document, { session }),
                  catch: storeUnavailable,
                });
                unit.emit(placed);
              }),
            {
              ...claimFor(commandId),
              replay: () => ({ record: serializeEntity(ProductOrder, order) }),
              afterCommit,
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'placed', order } as OrderPlacement;
          }
          if (outcome._tag === 'aborted') return yield* outcome.reason;
          const remembered = yield* units.replay(commandId as string);
          // Every claim this store takes remembers its order; a duplicate with
          // none is a collision, never a replay.
          if (Option.isNone(remembered)) {
            return yield* Effect.fail(storeUnavailable());
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

      move: (orderId, transition, commandId) =>
        Effect.gen(function* () {
          const outcome = yield* units.run(
            unit =>
              Effect.gen(function* () {
                const { db: handle, session } = unit.handle;
                // Each status the move is legal from, tried in turn: the write
                // is conditional on it, so a racing writer that moved the order
                // first leaves nothing for this one to match.
                for (const from of statusesBefore(transition)) {
                  const to = orderStatusAfter(from, transition) as string;
                  const moved = yield* shift(session, handle, orderId, [from], {
                    status: to,
                  });
                  if (moved === null) continue;
                  if (to === 'cancelled') {
                    unit.emit(event(ORDER_CANCELLED, orderId, moved));
                  }
                  return moved;
                }
                return yield* Effect.fail(new NotMoved());
              }),
            { ...claimFor(commandId), afterCommit },
          );
          if (outcome._tag === 'committed') return yield* revive(outcome.value);
          // A repeated command answers the order as it stands.
          if (outcome._tag === 'duplicate') return yield* current(orderId);
          return undefined;
        }),

      claimCancellation: (orderId, commandId) =>
        Effect.gen(function* () {
          const outcome = yield* units.run(
            unit =>
              Effect.gen(function* () {
                const { db: handle, session } = unit.handle;
                // Each status the claim is legal from, tried in turn, so the
                // one it was claimed from is remembered for its release.
                for (const from of statusesBefore('claim-cancel')) {
                  const claimed = yield* shift(
                    session,
                    handle,
                    orderId,
                    [from],
                    {
                      status: 'cancelling',
                      claimedFrom: from,
                    },
                  );
                  if (claimed !== null) return claimed;
                }
                return yield* Effect.fail(new NotMoved());
              }),
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
        Effect.gen(function* () {
          for (const back of statusesBefore('claim-cancel')) {
            const released = yield* Effect.tryPromise({
              try: () =>
                orders.updateOne(
                  { id: orderId, status: 'cancelling', claimedFrom: back },
                  { $set: { status: back }, $unset: { claimedFrom: '' } },
                ),
              catch: storeUnavailable,
            });
            if (released.modifiedCount > 0) return true;
          }
          return false;
        }),

      settleCancellation: (orderId, commandId) =>
        Effect.gen(function* () {
          const outcome = yield* units.run(
            unit =>
              Effect.flatMap(
                shift(
                  unit.handle.session,
                  unit.handle.db,
                  orderId,
                  ['cancelling'],
                  { status: 'cancelled' },
                ),
                updated => {
                  if (updated === null) return Effect.fail(new NotMoved());
                  unit.emit(event(ORDER_CANCELLED, orderId, updated));
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

/**
 * The `order` store's checkout groups. Opened under the flow's id, claimed on
 * the command that opened it, and deleted only as the checkout's compensation.
 */
export const MongoCheckoutGroupStoreLayer = Layer.effect(
  CheckoutGroupStoreTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const units = yield* MongoUnitOfWorkTag;
    const groups = db.collection(GROUP_COLLECTION);

    const revive = (document: unknown) =>
      deserializeSingleEntity(CheckoutGroup, document).pipe(
        Effect.mapError(storeUnavailable),
      );

    return {
      get: groupId =>
        Effect.tryPromise({
          try: () => groups.findOne({ id: groupId }, WITHOUT_ID),
          catch: storeUnavailable,
        }).pipe(
          Effect.flatMap(document =>
            document === null ? Effect.succeed(undefined) : revive(document),
          ),
        ),

      open: (group, commandId) =>
        Effect.gen(function* () {
          const document = {
            ...serializeEntity(CheckoutGroup, group),
            id: group.id,
          };
          const outcome = yield* units.run(
            unit =>
              Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(GROUP_COLLECTION)
                    .insertOne(document, { session: unit.handle.session }),
                catch: storeUnavailable,
              }),
            {
              ...(commandId === undefined
                ? {}
                : { claim: { kind: 'command' as const, commandId } }),
              replay: () => ({ record: serializeEntity(CheckoutGroup, group) }),
            },
          );
          if (outcome._tag === 'committed') {
            return { _tag: 'opened', group } as GroupOpening;
          }
          const remembered = yield* units.replay(commandId as string);
          if (Option.isNone(remembered)) {
            return yield* Effect.fail(storeUnavailable());
          }
          return {
            _tag: 'replayed',
            group: yield* revive(
              (remembered.value as { record: unknown }).record,
            ),
          } as GroupOpening;
        }),

      remove: groupId =>
        Effect.tryPromise({
          try: () => groups.deleteOne({ id: groupId }),
          catch: storeUnavailable,
        }).pipe(Effect.map(result => result.deletedCount > 0)),
    };
  }),
);

/** Both of the `order` store's ports over one database. */
export const MongoOrderStoresLayer = Layer.mergeAll(
  MongoProductOrderStoreLayer,
  MongoCheckoutGroupStoreLayer,
);
