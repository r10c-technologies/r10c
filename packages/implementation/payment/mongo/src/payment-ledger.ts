import {
  deserializeSingleEntity,
  DuplicateKey,
  type Entity,
  type EntityConstructor,
  envelopeEntityName,
  serializeEntity,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  isDuplicateKey,
  mongoUnitFault,
  MongoUnitOfWorkTag,
} from '@entifix/mongo/transactions';
import {
  EventBusTag,
  EventSourceTag,
  OutboxMaxAttempts,
} from '@entifix/transactions';
import {
  paymentCapturedEvent,
  paymentRefundedEvent,
} from '@r10c/business-ts-payment-contracts';
import {
  type LedgerWrite,
  Payment,
  PaymentAllocation,
  PaymentLedgerTag,
  Refund,
  type RefundReservation,
} from '@r10c/business-ts-payment-management';
import { Effect, Layer, Option } from 'effect';
import type { ClientSession, Db } from 'mongodb';

export const PAYMENT_COLLECTION = envelopeEntityName(Payment);
export const ALLOCATION_COLLECTION = envelopeEntityName(PaymentAllocation);
export const REFUND_COLLECTION = envelopeEntityName(Refund);

/** What a command claim remembers: the record the command decided. */
interface Remembered {
  readonly record: Record<string, unknown>;
}

const WITHOUT_ID = { projection: { _id: 0 } } as const;

const storeUnavailable = () => new Unavailable({ dependency: 'mongo' });

/** Less than the refund asked for is left of its allocation. */
class Exceeds {
  readonly _tag = 'Exceeds';
}

/**
 * The indexes the ledger's reads and its rules rest on. ⚠️ **An allocation is
 * unique on its order**: an order is paid for once, by one share of one
 * payment, and a second capture naming it is refused by the store rather than
 * by review. A refund is addressed by order, so `orderId` indexes both.
 */
export const ensurePaymentIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection(PAYMENT_COLLECTION)
        .createIndex({ groupId: 1, status: 1 }, { name: 'groupId_1_status_1' });
      await db
        .collection(ALLOCATION_COLLECTION)
        .createIndex({ orderId: 1 }, { unique: true, name: 'orderId_1' });
      await db
        .collection(REFUND_COLLECTION)
        .createIndex({ orderId: 1 }, { name: 'orderId_1' });
    },
    catch: storeUnavailable,
  });

/**
 * The `payment` store's ledger: every capture with its allocations, and every
 * refund, recorded with its announcement in one unit of work, claimed on the
 * command that asked for it, and drained to the bus the moment it commits.
 *
 * ⚠️ **A refund's amount is taken off its allocation by one guarded `$inc`**
 * (`refunded + amount <= captured`, as a `$expr`), before the provider moves
 * any money. That conditional write is the whole concurrency control for
 * partial refunds: a burst against one order serializes on the allocation
 * document, and the write that would go past the capture matches nothing.
 */
export const MongoPaymentLedgerLayer = Layer.effect(
  PaymentLedgerTag,
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const units = yield* MongoUnitOfWorkTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const source = yield* EventSourceTag;

    yield* ensurePaymentIndexes(db);

    const afterCommit = drainOutboxNow(db).pipe(
      Effect.provideService(EventBusTag, bus),
      Effect.provideService(OutboxMaxAttempts, maxAttempts),
    );

    const revive = <T extends Entity>(
      entity: EntityConstructor<T>,
      document: unknown,
    ) =>
      deserializeSingleEntity(entity, document).pipe(
        Effect.mapError(storeUnavailable),
      ) as Effect.Effect<T, Unavailable>;

    const findOne = <T extends Entity>(
      entity: EntityConstructor<T>,
      collection: string,
      filter: Record<string, unknown>,
    ) =>
      Effect.tryPromise({
        try: () => db.collection(collection).findOne(filter, WITHOUT_ID),
        catch: storeUnavailable,
      }).pipe(
        Effect.flatMap(document =>
          document === null
            ? Effect.succeed(undefined)
            : revive(entity, document),
        ),
      );

    /** The record a command remembers, if it ran before. */
    const remembered = (commandId: string | undefined) =>
      commandId === undefined
        ? Effect.succeed(Option.none<Remembered>())
        : (units.replay(commandId) as Effect.Effect<
            Option.Option<Remembered>,
            Unavailable
          >);

    /**
     * ⚠️ **A duplicate that remembers nothing is a failure, never a replay.**
     * Every claim this ledger takes stores its answer, so a duplicate with none
     * is an announcement whose id collided with another's — and answering it as
     * a replay would report a decision that was never recorded.
     */
    const rememberedOrFail = <T extends Entity>(
      entity: EntityConstructor<T>,
      commandId: string | undefined,
    ) =>
      Effect.flatMap(remembered(commandId), earlier =>
        Option.isSome(earlier)
          ? revive(entity, earlier.value.record)
          : Effect.fail(storeUnavailable()),
      );

    const claimFor = (commandId: string | undefined) =>
      commandId === undefined
        ? {}
        : { claim: { kind: 'command' as const, commandId } };

    const insert = (
      handle: { readonly db: Db; readonly session: ClientSession },
      collection: string,
      documents: readonly Record<string, unknown>[],
    ) =>
      Effect.tryPromise({
        try: () =>
          handle.db
            .collection(collection)
            .insertMany([...documents], { session: handle.session }),
        catch: error =>
          isDuplicateKey(error)
            ? new DuplicateKey({ key: 'orderId' })
            : mongoUnitFault(error),
      });

    const documentOf = <T extends Entity>(
      entity: EntityConstructor<T>,
      item: T,
    ) => ({ ...serializeEntity(entity, item), id: item.id });

    return {
      decidedPayment: commandId =>
        Effect.flatMap(remembered(commandId), earlier =>
          Option.isNone(earlier)
            ? Effect.succeed(Option.none<Payment>())
            : Effect.map(revive(Payment, earlier.value.record), Option.some),
        ),

      // A refund's decision lands after its reservation, so the record is read
      // as it stands now rather than as the command first remembered it.
      decidedRefund: commandId =>
        Effect.flatMap(remembered(commandId), earlier =>
          Option.isNone(earlier)
            ? Effect.succeed(Option.none<Refund>())
            : Effect.map(
                findOne(Refund, REFUND_COLLECTION, {
                  id: earlier.value.record['id'],
                }),
                Option.fromUndefinedOr,
              ),
        ),

      allocationFor: orderId =>
        findOne(PaymentAllocation, ALLOCATION_COLLECTION, { orderId }),

      recordCapture: (payment, allocations, outcome, commandId) =>
        Effect.gen(function* () {
          const captured = payment.status === 'captured';
          const written = yield* units.run(
            unit =>
              Effect.gen(function* () {
                yield* insert(unit.handle, PAYMENT_COLLECTION, [
                  {
                    ...documentOf(Payment, payment),
                    decidedAt: outcome.decidedAt,
                  },
                ]);
                // A declined capture is recorded, allocates nothing and is
                // announced to nobody: no slice subscribes to a refusal (ADR 0068).
                if (captured) {
                  yield* insert(
                    unit.handle,
                    ALLOCATION_COLLECTION,
                    allocations.map(share =>
                      documentOf(PaymentAllocation, share),
                    ),
                  );
                  unit.emit(paymentCapturedEvent(outcome, source));
                }
                return payment;
              }),
            {
              ...claimFor(commandId),
              replay: (): Remembered => ({
                record: serializeEntity(Payment, payment),
              }),
              afterCommit,
            },
          );
          if (written._tag === 'committed') {
            return {
              _tag: 'recorded',
              record: written.value,
            } as LedgerWrite<Payment>;
          }
          if (written._tag === 'aborted') return yield* written.reason;
          return {
            _tag: 'replayed',
            record: yield* rememberedOrFail(Payment, commandId),
          } as LedgerWrite<Payment>;
        }),

      reserveRefund: (refund, commandId) =>
        Effect.gen(function* () {
          const written = yield* units.run(
            unit =>
              Effect.gen(function* () {
                const taken = yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db.collection(ALLOCATION_COLLECTION).updateOne(
                      {
                        id: refund.allocationId,
                        $expr: {
                          $lte: [
                            { $add: ['$refunded', refund.amount] },
                            '$captured',
                          ],
                        },
                      },
                      { $inc: { refunded: refund.amount } },
                      { session: unit.handle.session },
                    ),
                  catch: mongoUnitFault,
                });
                if (taken.modifiedCount === 0) {
                  return yield* Effect.fail(new Exceeds());
                }
                yield* insert(unit.handle, REFUND_COLLECTION, [
                  documentOf(Refund, refund),
                ]);
                return refund;
              }),
            {
              ...claimFor(commandId),
              replay: (): Remembered => ({
                record: serializeEntity(Refund, refund),
              }),
            },
          );
          if (written._tag === 'committed') {
            return {
              _tag: 'reserved',
              refund: written.value,
            } as RefundReservation;
          }
          if (written._tag === 'duplicate') {
            const first = yield* rememberedOrFail(Refund, commandId);
            const current = yield* findOne(Refund, REFUND_COLLECTION, {
              id: first.id,
            });
            return {
              _tag: 'replayed',
              refund: current ?? first,
            } as RefundReservation;
          }
          // The one refusal inside the unit: less is left than was asked for.
          const allocation = yield* findOne(
            PaymentAllocation,
            ALLOCATION_COLLECTION,
            { id: refund.allocationId },
          );
          return {
            _tag: 'exceeds',
            remaining:
              allocation === undefined
                ? 0
                : allocation.captured - allocation.refunded,
          } as RefundReservation;
        }),

      decideRefund: (refund, outcome) =>
        Effect.gen(function* () {
          const refunded = refund.status === 'refunded';
          yield* units.run(
            unit =>
              Effect.gen(function* () {
                const decided = yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db.collection(REFUND_COLLECTION).updateOne(
                      { id: refund.id, status: 'pending' },
                      {
                        $set: {
                          status: refund.status,
                          providerReference: refund.providerReference,
                          decidedAt: refund.decidedAt,
                        },
                      },
                      { session: unit.handle.session },
                    ),
                  catch: mongoUnitFault,
                });
                // Decided already: a second answer for one refund changes nothing.
                if (decided.modifiedCount === 0) return;
                if (refunded) {
                  unit.emit(paymentRefundedEvent(outcome, source));
                  return;
                }
                // The provider declined: the share goes back to the allocation.
                yield* Effect.tryPromise({
                  try: () =>
                    unit.handle.db
                      .collection(ALLOCATION_COLLECTION)
                      .updateOne(
                        { id: refund.allocationId },
                        { $inc: { refunded: -refund.amount } },
                        { session: unit.handle.session },
                      ),
                  catch: mongoUnitFault,
                });
              }),
            { afterCommit },
          );
          const current = yield* findOne(Refund, REFUND_COLLECTION, {
            id: refund.id,
          });
          return current ?? refund;
        }),
    };
  }),
);
