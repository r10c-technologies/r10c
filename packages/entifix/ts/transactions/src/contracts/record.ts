import type { EntifixConnError, EntityId } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { TransactionEvent, TransactionState } from './event';

/**
 * The the saga tracker's persisted view of a transaction, folded from the
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
  /**
   * Whose organization this transaction happened in, folded from the event.
   *
   * The `saga` store is control-plane and single-partition — it holds every
   * organization's records by design — so isolation on the read routes has to be
   * this filter. A record written before the member existed carries none and is
   * therefore readable by nobody, which is the direction to fail (ADR 0036).
   */
  organizationId?: string;
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
  // There is deliberately no `list`. The `saga` store is control-plane and
  // single-partition, so an unfiltered index is every organization's
  // transactions — which is the surface #194 deleted `GET /api/transaction` for.
  // Anything that needs a set of records asks for one narrow enough to scope,
  // the way `findStale` does.
  /** Non-terminal records not updated within `olderThanMs` — recovery input. */
  findStale(
    olderThanMs: number,
  ): Effect.Effect<readonly TransactionRecord[], EntifixConnError>;
  markStale(transactionId: string): Effect.Effect<void, EntifixConnError>;
  /**
   * How many records sit in each state — the recovery sweep samples it.
   *
   * ⚠️ **This is a count, and is not the `list` above.** It returns no record,
   * no id and no organization, so it does not reopen the surface #194 deleted
   * `GET /api/transaction` for: an unfiltered *listing* of this store is every
   * organization's transactions, while a total of how many are `STALE` is a
   * fleet health number that names nobody. The distinction is the whole reason
   * one is here and the other is refused.
   *
   * It exists so `STALE` is something a dashboard shows rather than something a
   * poll discovers — which is what the recovery sweep, whose only action is to
   * apply that label, otherwise leaves entirely unobservable.
   */
  countByState(): Effect.Effect<
    Record<TransactionState, number>,
    EntifixConnError
  >;
}

export class TransactionStoreTag extends Context.Tag('TransactionStoreTag')<
  TransactionStoreTag,
  TransactionStore
>() {}
