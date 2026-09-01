import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { TransactionEvent, TransactionStep } from './event';

/**
 * A transaction event recorded durably *before* it reaches the broker.
 *
 * The point of the outbox is that a state change and the event announcing it
 * become one fact. `execute` used to write Mongo and then call `bus.publish`
 * separately: with the broker down between the two, the write happened and the
 * event never did, so the saga record sat `PENDING` until the sweep mislabelled
 * a successful transaction `STALE`. An entry written in the same transaction as
 * the state change cannot be lost that way, and a relay carries it to the bus
 * afterwards.
 */
export interface OutboxEntry {
  transactionId: string;
  /** Which facade step this entry announces — unique per transaction. */
  step: TransactionStep;
  event: TransactionEvent;
  sent: boolean;
  /** ISO-8601, and the drain order: entries publish oldest-first. */
  createdAt: string;
}

/**
 * Whether {@link TransactionOutbox.enqueue} actually wrote.
 *
 * `duplicate` is not a failure — it is how a *retry* is recognised. The
 * transaction id is the client's idempotency key (ADR 0028), so a repeated
 * command must return the first one's answer rather than execute twice. The
 * adapter owns the detection because the mechanism is storage-specific (a Mongo
 * `E11000` against the unique index on `transactionId + step`), and translating
 * it here keeps driver error codes out of route handlers.
 */
export type OutboxEnqueueResult = 'enqueued' | 'duplicate';

/**
 * The durable hand-off between a transactional write and the event bus.
 *
 * Deliberately **not** a publisher: it never touches the broker. `enqueue` is
 * the only write, and the relay composes `pending`/`markSent` with an
 * {@link EventBus} — which is what keeps the engine framework-free and lets the
 * relay be tested without either a database or a broker.
 *
 * There is no `enqueueWithin(session)` here on purpose. Making the `completed`
 * entry atomic with the entity write needs the storage driver's own session, and
 * putting one in this port (or in `EntityRepository`) would drag Mongo into a
 * framework-free contract. The handler owns that write instead — see
 * {@link TransactionHandler}.
 */
export interface TransactionOutbox {
  /** Record an event durably. Idempotent per `transactionId + step`. */
  enqueue(
    event: TransactionEvent,
  ): Effect.Effect<OutboxEnqueueResult, EntifixConnError>;
  /** Unsent entries, oldest first — the relay's input. */
  pending(
    limit: number,
  ): Effect.Effect<readonly OutboxEntry[], EntifixConnError>;
  /**
   * Mark an entry published. A crash between the publish and this call re-sends
   * the event on the next drain, which is why delivery is at-least-once and why
   * consumers must dedupe on `transactionId`.
   */
  markSent(entry: OutboxEntry): Effect.Effect<void, EntifixConnError>;
}

export class TransactionOutboxTag extends Context.Tag('TransactionOutboxTag')<
  TransactionOutboxTag,
  TransactionOutbox
>() {}
