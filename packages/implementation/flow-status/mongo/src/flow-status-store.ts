import { type AudienceEntry, Unavailable } from '@entifix/core';
import { MongoDatabaseTag } from '@entifix/mongo';
import { MongoUnitOfWorkTag } from '@entifix/mongo/transactions';
import {
  type FlowFailure,
  type FlowState,
  type FlowStatusApplied,
  type FlowStatusRecord,
  FlowStatusStoreTag,
} from '@r10c/business-ts-flow-contracts';
import { Effect, Layer } from 'effect';
import type { ClientSession, Db } from 'mongodb';

/** The one collection of the `flow-status` store. */
export const FLOW_STATUS_COLLECTION = 'flow-status';

/** A record as it sits in Mongo: the port's shape, keyed by `flowId`. */
interface FlowStatusDocument {
  readonly flowId: string;
  readonly definition: string;
  readonly slipVersion: number;
  readonly state: FlowState;
  readonly step?: string;
  readonly failure?: FlowFailure;
  readonly audience: readonly AudienceEntry[];
  readonly capabilityDigest?: string;
  readonly version: number;
  readonly updatedAt: Date;
}

const unavailable = () => new Unavailable({ dependency: 'mongo' });

const promise = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: unavailable });

const recordOf = ({
  flowId,
  definition,
  slipVersion,
  state,
  step,
  failure,
  audience,
  capabilityDigest,
  version,
  updatedAt,
}: FlowStatusDocument): FlowStatusRecord => ({
  flowId,
  definition,
  slipVersion,
  state,
  ...(step === undefined ? {} : { step }),
  ...(failure === undefined ? {} : { failure }),
  audience,
  ...(capabilityDigest === undefined ? {} : { capabilityDigest }),
  version,
  updatedAt,
});

/**
 * One record per flow, and a TTL that retires it `ttlSeconds` after its last
 * event — a finished flow is read by a catch-up for minutes, never for weeks,
 * and the journal it projects is the engine's to keep.
 */
export const ensureFlowStatusIndexes = (db: Db, ttlSeconds: number) =>
  promise(async () => {
    const collection = db.collection(FLOW_STATUS_COLLECTION);
    await collection.createIndex({ flowId: 1 }, { unique: true });
    await collection.createIndex(
      { updatedAt: 1 },
      { expireAfterSeconds: ttlSeconds },
    );
  });

/**
 * The version-guarded write, inside the unit that claims the message.
 *
 * ⚠️ **Read and replace in one transaction, not a conditional upsert.** The
 * published projections guard with an upsert that a unique index refuses, but
 * here the write shares a transaction with the inbox claim, and a duplicate-key
 * error aborts the transaction server-side — the claim would roll back with it
 * and the outcome would read as a store fault. Under the transaction's snapshot
 * a concurrent writer is a write conflict instead, which fails the unit and is
 * redelivered: the version check then answers it.
 */
const applyIn = (
  db: Db,
  session: ClientSession,
  record: FlowStatusRecord,
): Effect.Effect<FlowStatusApplied, Unavailable> =>
  promise(async () => {
    const collection = db.collection<FlowStatusDocument>(
      FLOW_STATUS_COLLECTION,
    );
    const current = await collection.findOne(
      { flowId: record.flowId },
      { session },
    );
    if (current !== null && current.version >= record.version) return 'stale';
    await collection.replaceOne(
      { flowId: record.flowId },
      { ...record },
      { upsert: true, session },
    );
    return 'applied';
  });

export interface FlowStatusStoreOptions {
  /** How long a record outlives its last event (`realtime.flowStatusTtlS`). */
  readonly ttlSeconds: number;
}

/**
 * The `flow-status` store over Mongo, written by the realtime slice alone
 * ([ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 */
export const MongoFlowStatusStoreLayer = ({ ttlSeconds }: FlowStatusStoreOptions) =>
  Layer.effect(
    FlowStatusStoreTag,
    Effect.gen(function* () {
      const db = yield* MongoDatabaseTag;
      const units = yield* MongoUnitOfWorkTag;
      yield* ensureFlowStatusIndexes(db, ttlSeconds);
      const collection = db.collection<FlowStatusDocument>(
        FLOW_STATUS_COLLECTION,
      );

      return {
        read: flowId =>
          Effect.map(
            promise(() => collection.findOne({ flowId })),
            document => (document === null ? undefined : recordOf(document)),
          ),
        readMany: flowIds =>
          flowIds.length === 0
            ? Effect.succeed([])
            : Effect.map(
                promise(() =>
                  collection.find({ flowId: { $in: [...flowIds] } }).toArray(),
                ),
                documents => documents.map(recordOf),
              ),
        apply: (record, claim) =>
          Effect.map(
            units.run(unit => applyIn(db, unit.handle.session, record), {
              claim: { kind: 'event', ...claim },
            }),
            outcome =>
              outcome._tag === 'committed' ? outcome.value : 'duplicate',
          ),
      };
    }),
  );
