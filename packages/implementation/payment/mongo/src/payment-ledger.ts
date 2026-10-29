import {
  deserializeSingleEntity,
  type Entity,
  type EntityConstructor,
  envelopeEntityName,
  serializeEntity,
  type TransitionalFailure,
  Unavailable,
} from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import {
  drainOutboxNow,
  isDuplicateKey,
  MongoUnitOfWorkTag,
  OutboxMaxAttempts,
} from '@entifix/mongo/transactions';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  paymentCapturedEvent,
  paymentRefundedEvent,
} from '@r10c/business-ts-payment-contracts';
import {
  type LedgerWrite,
  Payment,
  PaymentLedgerTag,
  Refund,
} from '@r10c/business-ts-payment-management';
import { Effect, Layer, Option } from 'effect';
import type { Db } from 'mongodb';

export const PAYMENT_COLLECTION = envelopeEntityName(Payment);
export const REFUND_COLLECTION = envelopeEntityName(Refund);

/** What a command claim remembers: the record the command decided. */
interface Remembered {
  readonly record: Record<string, unknown>;
}

const WITHOUT_ID = { projection: { _id: 0 } } as const;

/** One refund per capture — a second command aimed at it finds this. */
class RefundRaced {
  readonly _tag = 'RefundRaced';
}

/**
 * The indexes the ledger's reads and its one-refund-per-capture rule rest on.
 * A refund is addressed by order and resolves its own capture, so
 * `(orderId, status)` is on the hot path of every cancellation.
 */
export const ensurePaymentIndexes = (db: Db) =>
  Effect.tryPromise({
    try: async () => {
      await db
        .collection(PAYMENT_COLLECTION)
        .createIndex({ orderId: 1, status: 1 }, { name: 'orderId_1_status_1' });
      await db
        .collection(REFUND_COLLECTION)
        .createIndex({ paymentId: 1 }, { unique: true, name: 'paymentId_1' });
    },
    catch: () => new Unavailable({ dependency: 'mongo' }),
  });

/**
 * The `payment` store's ledger: every capture and refund recorded with its
 * announcement in one unit of work, claimed on the command that asked for it,
 * and drained to the bus the moment it commits.
 *
 * ⚠️ **The drain is the fast path, and the reason it is here.** The relay's
 * sweep is fifteen seconds away; an order waits on `payment.captured` to leave
 * `pending`, so a capture announced only by the sweep is a buyer looking at a
 * pending order for no reason. The sweep stays the fallback for a drain that
 * fails.
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
        Effect.mapError(() => new Unavailable({ dependency: 'mongo' })),
      ) as Effect.Effect<T, TransitionalFailure>;

    const findOne = <T extends Entity>(
      entity: EntityConstructor<T>,
      collection: string,
      filter: Record<string, unknown>,
    ) =>
      Effect.tryPromise({
        try: () => db.collection(collection).findOne(filter, WITHOUT_ID),
        catch: () => new Unavailable({ dependency: 'mongo' }),
      }).pipe(
        Effect.flatMap(document =>
          document === null
            ? Effect.succeed(undefined)
            : revive(entity, document),
        ),
      );

    const decided = <T extends Entity>(
      entity: EntityConstructor<T>,
      commandId: string,
    ) =>
      Effect.flatMap(units.replay(commandId), remembered =>
        Option.isNone(remembered)
          ? Effect.succeed(Option.none<T>())
          : Effect.map(
              revive(entity, (remembered.value as Remembered).record),
              Option.some,
            ),
      );

    /**
     * What a duplicate unit's command decided.
     *
     * ⚠️ **A duplicate that remembers nothing is a failure, never a replay.**
     * Every claim this ledger takes stores its answer, so a duplicate with none
     * is an announcement whose id collided with another's — and answering it as
     * a replay would report a decision that was never recorded.
     */
    const rememberedOrFail = <T extends Entity>(
      entity: EntityConstructor<T>,
      commandId: string | undefined,
    ) =>
      Effect.flatMap(
        commandId === undefined
          ? Effect.succeed(Option.none<T>())
          : decided(entity, commandId),
        earlier =>
          Option.isSome(earlier)
            ? Effect.succeed(earlier.value)
            : Effect.fail(new Unavailable({ dependency: 'mongo' })),
      );

    /** A record's write, its event and the command's claim, as one unit. */
    const record = <T extends Entity>(
      entity: EntityConstructor<T>,
      collection: string,
      item: T,
      event: Parameters<typeof paymentCapturedEvent>[0] | undefined,
      eventFor: typeof paymentCapturedEvent,
      commandId: string | undefined,
    ) =>
      Effect.gen(function* () {
        const document = {
          ...serializeEntity(entity, item),
          id: item.id,
          ...(event ? { decidedAt: event.decidedAt } : {}),
        };
        const outcome = yield* units.run(
          unit =>
            Effect.gen(function* () {
              yield* Effect.tryPromise({
                try: () =>
                  unit.handle.db
                    .collection(collection)
                    .insertOne(document, { session: unit.handle.session }),
                catch: error =>
                  isDuplicateKey(error)
                    ? new RefundRaced()
                    : new Unavailable({ dependency: 'mongo' }),
              });
              if (event) unit.emit(eventFor(event, source));
              return item;
            }),
          {
            ...(commandId === undefined
              ? {}
              : { claim: { kind: 'command' as const, commandId } }),
            replay: (): Remembered => ({
              record: serializeEntity(entity, item),
            }),
            afterCommit,
          },
        );
        return outcome;
      });

    return {
      decidedPayment: commandId => decided(Payment, commandId),
      decidedRefund: commandId => decided(Refund, commandId),
      captureFor: orderId =>
        findOne(Payment, PAYMENT_COLLECTION, { orderId, status: 'captured' }),
      refundFor: paymentId => findOne(Refund, REFUND_COLLECTION, { paymentId }),

      recordCapture: (payment, outcome, commandId) =>
        Effect.gen(function* () {
          // A declined capture is recorded and announced to nobody: no slice
          // subscribes to a refusal, which the saga answers by compensating
          // (ADR 0068).
          const written = yield* record(
            Payment,
            PAYMENT_COLLECTION,
            payment,
            payment.status === 'captured' ? outcome : undefined,
            paymentCapturedEvent,
            commandId,
          );
          if (written._tag === 'committed') {
            return {
              _tag: 'recorded',
              record: written.value,
            } as LedgerWrite<Payment>;
          }
          // A capture's id is minted per attempt, so it can only collide on its
          // command: what that command decided is the answer.
          return {
            _tag: 'replayed',
            record: yield* rememberedOrFail(Payment, commandId),
          } as LedgerWrite<Payment>;
        }),

      recordRefund: (refund, outcome, commandId) =>
        Effect.gen(function* () {
          // A refused refund is recorded and announced to nobody, like a declined
          // capture.
          const written = yield* record(
            Refund,
            REFUND_COLLECTION,
            refund,
            refund.status === 'refunded' ? outcome : undefined,
            paymentRefundedEvent,
            commandId,
          );
          if (written._tag === 'committed') {
            return {
              _tag: 'recorded',
              record: written.value,
            } as LedgerWrite<Refund>;
          }
          if (written._tag === 'duplicate') {
            return {
              _tag: 'replayed',
              record: yield* rememberedOrFail(Refund, commandId),
            } as LedgerWrite<Refund>;
          }
          // Raced: a sibling command recorded this capture's refund first.
          const sibling = yield* findOne(Refund, REFUND_COLLECTION, {
            paymentId: refund.paymentId,
          });
          return {
            _tag: 'replayed',
            record: sibling ?? refund,
          } as LedgerWrite<Refund>;
        }),
    };
  }),
);
