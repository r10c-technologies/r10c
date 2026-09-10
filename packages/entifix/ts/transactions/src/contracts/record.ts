import {
  type EntifixConnError,
  type EntifixError,
  type EntityId,
  readEnvelope,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

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

/**
 * What a service answers a `202` with: the id to poll, and the state it starts
 * in.
 *
 * ⚠️ **Not a {@link TransactionRecord}, which is why it has its own
 * discriminant.** Nothing has been folded yet — there is no `createdAt`, no
 * entity id, and no code, because the write has not run. Framing it as a record
 * meant the browser's accept-shape assertion was checking a name that the
 * by-id route and the bus payload also answered to, so it asserted nothing it
 * claimed to (#176,
 * [ADR 0055](../../../../../../docs/adr/0055-a-coordinator-resumes-from-its-own-record.md)).
 */
export interface TransactionAccepted {
  transactionId: string;
  state: TransactionState;
}

/**
 * Parses a `202` accept body, for a browser about to start polling.
 *
 * Read for its **shape**, not its contents: it asserts the service really
 * accepted a transaction rather than answering something else with a `2xx`.
 */
export function readTransactionAcceptedEnvelope(
  body: unknown,
): Effect.Effect<TransactionAccepted, EntifixError> {
  return Effect.map(
    readEnvelope<TransactionAccepted>(
      body,
      'transactionAccepted',
      'transactionAccepted',
    ),
    envelope => envelope.data,
  );
}

/**
 * Parses the tracker's by-id response, which frames a {@link TransactionRecord}.
 *
 * ⚠️ **`readEnvelope` validates the discriminant and then *casts* the payload**
 * — it checks no members. So a discriminant shared by two shapes hands back
 * whichever one the caller asked for, typed and wrong: a record read as an
 * event has no `step`, no `at`, and a `state` the caller is about to branch on.
 * That is the reason the four transaction-shaped discriminants are four.
 */
export function readTransactionRecordEnvelope(
  body: unknown,
): Effect.Effect<TransactionRecord, EntifixError> {
  return Effect.map(
    readEnvelope<TransactionRecord>(
      body,
      'transactionRecord',
      'transactionRecord',
    ),
    envelope => envelope.data,
  );
}

/**
 * Reads one transaction's record, for a browser reconciling a write it started.
 *
 * ⚠️ **`undefined` means _not tracked yet_, not _failed_.** `accepted` reaches
 * the tracker over the bus, so with the broker down the entity write commits —
 * the outbox is in the same Mongo transaction — while no event is ever
 * published and this answers `404`. That is a write in perfect health, and a
 * caller that rolls back on it un-renders a record that is about to appear, at
 * exactly the moment nobody can tell a UI bug from an outage. Only `FAILED` and
 * `STALE` are terminal (ADR 0043).
 */
export interface TransactionStatusReader {
  read(
    transactionId: string,
  ): Effect.Effect<TransactionRecord | undefined, EntifixError>;
}

export class TransactionStatusReaderTag extends Context.Tag(
  'TransactionStatusReaderTag',
)<TransactionStatusReaderTag, TransactionStatusReader>() {}
