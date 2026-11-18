import {
  deserializeSingleEntity,
  envelopeEntityName,
  NotFound,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  COMMAND_INBOX_COLLECTION,
  drainOutboxNow,
  mongoUnitFault,
  MongoUnitOfWorkTag,
} from '@entifix/mongo/transactions';
import {
  EventBusTag,
  EventSourceTag,
  type OutboxEvent,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  drawOrderNumber,
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
  type OrderStatus,
  orderStatusAfter,
  ProductOrder,
  ProductOrderStoreTag,
  statusesBefore,
} from '@r10c/business-ts-order-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const ORDER_COLLECTION = envelopeEntityName(ProductOrder);
export const GROUP_COLLECTION = envelopeEntityName(CheckoutGroup);

/**
 * Removes `member` from the record each matching command claim remembered for
 * a redelivery, so personal data leaves the store and not only the record. The
 * replay is the record as the command wrote it, and a serialized record
 * carries its number rather than its id. Rewritten whole rather than `$unset`
 * on a dotted path, one claim at a time, inside the caller's unit.
 */
const forgetRemembered = async (
  db: Db,
  session: ClientSession,
  claim: Readonly<Record<string, string>>,
  member: string,
) => {
  const inbox = db.collection(COMMAND_INBOX_COLLECTION);
  const remembered = await inbox
    .find(claim, { projection: { _id: 0, commandId: 1, replay: 1 }, session })
    .toArray();
  for (const { commandId, replay } of remembered) {
    const { record, ...rest } = replay as { record: Record<string, unknown> };
    const kept = Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== member),
    );
    await inbox.updateOne(
      { commandId },
      { $set: { replay: { ...rest, record: kept } } },
      { session },
    );
  }
};

/** How many ended receipts one retention pass takes; the next takes the rest. */
const BATCH = 100;

/** The statuses a group's contact waits for every order to reach. */
const CLOSED_STATUSES: readonly OrderStatus[] = ['fulfilled', 'cancelled'];

/** The members of a serialized order an event's audience is read from. */
type SerializedOrder = Record<string, unknown> & {
  readonly buyerId?: string;
  readonly vendorId?: string;
};

const WITHOUT_ID = { projection: { _id: 0 } } as const;

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/** The unique index an order or a group number is held to (ADR 0076 §5). */
const NUMBER_INDEX = 'number_1';

/** A number another record already holds: the write redraws and runs again. */
class NumberTaken {
  readonly _tag = 'NumberTaken';
}

/**
 * How many numbers a write draws before it gives up. At 32⁸ a second collision
 * in a row is already a sign the index or the drawer is wrong, not bad luck.
 */
const MAX_DRAWS = 5;

/**
 * A duplicate key on the number index, read from `keyPattern` where the
 * server gives one and from the message's `dup key: { number: … }` otherwise —
 * a duplicate on anything else (an `id`) is a fault, never a redraw.
 */
const isNumberTaken = (error: unknown) => {
  const fault = error as {
    readonly code?: unknown;
    readonly keyPattern?: Record<string, unknown>;
    readonly message?: unknown;
  } | null;
  if (fault?.code !== 11000) return false;
  if (fault.keyPattern !== undefined)
    return fault.keyPattern['number'] !== undefined;
  return /dup key: \{\s*"?number"?\s*:/.test(String(fault.message));
};

/** An insert whose number collision is a redraw rather than a fault. */
const insertNumbered = (insert: () => Promise<unknown>) =>
  Effect.tryPromise({
    try: insert,
    catch: error =>
      isNumberTaken(error) ? new NumberTaken() : mongoUnitFault(error),
  });

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
      await orders.createIndex(
        { number: 1 },
        { name: NUMBER_INDEX, unique: true },
      );
      const groups = db.collection(GROUP_COLLECTION);
      await groups.createIndex(
        { buyerId: 1, placedAt: -1 },
        { name: 'buyerId_1_placedAt_-1' },
      );
      await groups.createIndex(
        { number: 1 },
        { name: NUMBER_INDEX, unique: true },
      );
      // A redemption finds its group by the link's digest alone; only groups
      // holding a live link carry one.
      await groups.createIndex(
        { accessDigest: 1 },
        { name: 'accessDigest_1', sparse: true },
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
        catch: mongoUnitFault,
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

    /** One placing, under the number the order holds now. */
    const placeOnce = (order: ProductOrder, commandId: string | undefined) =>
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
                catch: mongoUnitFault,
              });
              if (joined.matchedCount === 0) {
                return yield* Effect.fail(
                  new NotFound({ entity: 'checkout-group' }),
                );
              }
              yield* insertNumbered(() =>
                handle
                  .collection(ORDER_COLLECTION)
                  .insertOne(document, { session }),
              );
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
        if (outcome._tag === 'aborted') {
          if (outcome.reason instanceof NumberTaken)
            return 'numberTaken' as const;
          return yield* outcome.reason;
        }
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
      });

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
          if (order.number === '') order.number = drawOrderNumber();
          let draws = 1;
          for (;;) {
            const placing = yield* placeOnce(order, commandId);
            if (placing !== 'numberTaken') return placing;
            if (draws === MAX_DRAWS)
              return yield* Effect.fail(storeUnavailable());
            draws += 1;
            order.number = drawOrderNumber();
          }
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
                catch: mongoUnitFault,
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

    /** One opening, under the number the group holds now. */
    const openOnce = (group: CheckoutGroup, commandId: string | undefined) =>
      Effect.gen(function* () {
        const document = {
          ...serializeEntity(CheckoutGroup, group),
          id: group.id,
        };
        const outcome = yield* units.run(
          unit =>
            insertNumbered(() =>
              unit.handle.db
                .collection(GROUP_COLLECTION)
                .insertOne(document, { session: unit.handle.session }),
            ),
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
        if (outcome._tag === 'aborted') return 'numberTaken' as const;
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
      });

    const get = (groupId: string) =>
      Effect.tryPromise({
        try: () => groups.findOne({ id: groupId }, WITHOUT_ID),
        catch: storeUnavailable,
      }).pipe(
        Effect.flatMap(document =>
          document === null ? Effect.succeed(undefined) : revive(document),
        ),
      );

    return {
      get,

      open: (group, commandId) =>
        Effect.gen(function* () {
          if (group.number === '') group.number = drawOrderNumber();
          let draws = 1;
          for (;;) {
            const opening = yield* openOnce(group, commandId);
            if (opening !== 'numberTaken') return opening;
            if (draws === MAX_DRAWS)
              return yield* Effect.fail(storeUnavailable());
            draws += 1;
            group.number = drawOrderNumber();
          }
        }),

      remove: groupId =>
        Effect.tryPromise({
          try: () => groups.deleteOne({ id: groupId }),
          catch: storeUnavailable,
        }).pipe(Effect.map(result => result.deletedCount > 0)),

      // One conditional write: two racing lookups mail once. A `Date`, never
      // its ISO string — the stamps are stored as dates, and Mongo never
      // orders a string against one.
      issueAccess: (groupId, grant, notSentSince) =>
        Effect.tryPromise({
          try: () =>
            groups.findOneAndUpdate(
              {
                id: groupId,
                ...(notSentSince === undefined
                  ? {}
                  : {
                      $or: [
                        { accessSentAt: null },
                        { accessSentAt: { $lt: notSentSince } },
                      ],
                    }),
              },
              {
                $set: {
                  accessDigest: grant.digest,
                  accessExpiresAt: grant.expiresAt,
                  accessSentAt: grant.sentAt,
                },
              },
              { returnDocument: 'after', ...WITHOUT_ID },
            ),
          catch: storeUnavailable,
        }).pipe(
          Effect.flatMap(document =>
            document === null ? Effect.succeed(undefined) : revive(document),
          ),
        ),

      // Exactly one of two racing redemptions matches: the winner clears the
      // digest the loser's filter needs (ADR 0076 §6).
      redeemAccess: (accessDigest, cancelDigest, now) =>
        Effect.tryPromise({
          try: () =>
            groups.findOneAndUpdate(
              { accessDigest, accessExpiresAt: { $gt: now } },
              {
                $set: { cancelDigest },
                $unset: { accessDigest: '', accessExpiresAt: '' },
              },
              { returnDocument: 'after', projection: { _id: 0, id: 1 } },
            ),
          catch: storeUnavailable,
        }).pipe(
          Effect.map(document =>
            document === null ? undefined : String(document['id']),
          ),
        ),

      // A number is the group's own or one of its orders'; both are unique,
      // so at most one of the two reads names a group.
      findByNumber: number =>
        Effect.gen(function* () {
          const [own, order] = yield* Effect.tryPromise({
            try: () =>
              Promise.all([
                groups.findOne({ number }, { projection: { _id: 0, id: 1 } }),
                db
                  .collection(ORDER_COLLECTION)
                  .findOne({ number }, { projection: { _id: 0, groupId: 1 } }),
              ]),
            catch: storeUnavailable,
          });
          const groupId = own?.['id'] ?? order?.['groupId'];
          return groupId === undefined
            ? undefined
            : yield* get(String(groupId));
        }),

      // ADR 0076 §4. Each group in a unit of its own: the contact and the copy
      // its opening command remembered leave together, and one that fails
      // leaves the rest to this pass and itself to the next. A `Date` bound,
      // never its ISO string: the stamps are stored as dates.
      redactEndedReceipts: now =>
        Effect.gen(function* () {
          const ended = yield* Effect.tryPromise({
            try: () =>
              groups
                .find(
                  {
                    receiptEndsAt: { $lt: now },
                    'contact.phone': { $exists: true },
                  },
                  { projection: { _id: 0, id: 1, number: 1 }, limit: BATCH },
                )
                .toArray(),
            catch: storeUnavailable,
          });
          let redacted = 0;
          for (const { id, number } of ended as unknown as ReadonlyArray<{
            id: string;
            number: string;
          }>) {
            const open = yield* Effect.tryPromise({
              try: () =>
                db
                  .collection(ORDER_COLLECTION)
                  .countDocuments(
                    { groupId: id, status: { $nin: CLOSED_STATUSES } },
                    { limit: 1 },
                  ),
              catch: storeUnavailable,
            });
            if (open > 0) continue;
            const outcome = yield* units.run(unit =>
              Effect.tryPromise({
                try: async () => {
                  const session = unit.handle.session;
                  const written = await unit.handle.db
                    .collection(GROUP_COLLECTION)
                    .updateOne(
                      { id, 'contact.phone': { $exists: true } },
                      { $unset: { contact: '' }, $set: { redactedAt: now } },
                      { session },
                    );
                  await forgetRemembered(
                    unit.handle.db,
                    session,
                    { 'replay.record.number': number },
                    'contact',
                  );
                  return written.modifiedCount;
                },
                catch: mongoUnitFault,
              }),
            );
            // A unit with no claim and no refusal of its own only commits; a
            // store fault fails the effect instead of reaching here.
            redacted += (outcome as { readonly value: number }).value;
          }
          return redacted;
        }),
    };
  }),
);

/** Both of the `order` store's ports over one database. */
export const MongoOrderStoresLayer = Layer.mergeAll(
  MongoProductOrderStoreLayer,
  MongoCheckoutGroupStoreLayer,
);
