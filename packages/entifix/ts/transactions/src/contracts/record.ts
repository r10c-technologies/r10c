import type { EntifixConnError, EntityId } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { TransactionEvent, TransactionState } from './event';

/**
 * The `transaction-manager`'s persisted view of a transaction, folded from the
 * events it observes. It is the source of truth a client polls.
 */
export interface TransactionRecord {
  transactionId: string;
  entity: string;
  state: TransactionState;
  code?: string;
  entityId?: EntityId;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Port the manager tracks transactions through. Implemented over Mongo in the
 * service; framework-free here so the engine/manager stay environment-agnostic.
 */
export interface TransactionStore {
  /** Folds an event into the record, creating it on first sight. */
  upsertFromEvent(
    event: TransactionEvent,
  ): Effect.Effect<TransactionRecord, EntifixConnError>;
  get(
    transactionId: string,
  ): Effect.Effect<TransactionRecord | undefined, EntifixConnError>;
  list(): Effect.Effect<readonly TransactionRecord[], EntifixConnError>;
  /** Non-terminal records not updated within `olderThanMs` — recovery input. */
  findStale(
    olderThanMs: number,
  ): Effect.Effect<readonly TransactionRecord[], EntifixConnError>;
  markStale(transactionId: string): Effect.Effect<void, EntifixConnError>;
}

export class TransactionStoreTag extends Context.Tag('TransactionStoreTag')<
  TransactionStoreTag,
  TransactionStore
>() {}
