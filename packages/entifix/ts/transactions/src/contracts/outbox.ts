import type { DomainEvent, EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

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
  /**
   * The message's own id, denormalized out of `event` so the unique index sits
   * on a plain top-level field rather than a nested path.
   *
   * This **is** the idempotency claim: for a transaction step it is
   * `<transactionId>:<step>`, so a replayed command collides here and is
   * recognised as a retry before any lock is taken or work forked.
   */
  eventId: string;
  event: DomainEvent;
  sent: boolean;
  /**
   * Publish attempts already spent on this entry.
   *
   * The relay drains in order and stops at the first failure, which is what
   * keeps `accepted` ahead of a terminal event — and is also why an entry that
   * can *never* publish used to block everything behind it forever. Counting
   * the attempts is what turns "retrying" into a state with an end
   * (ADR 0030).
   */
  attempts: number;
  /**
   * Why the last attempt failed. Absent until one has, so its presence alone
   * says this entry has been tried.
   */
  lastError?: string;
  /**
   * Set once the attempts are spent. A quarantined entry is **skipped** rather
   * than retried, so the head of the line moves; nothing deletes it, because a
   * stuck transaction nobody is told about is the same as a lost one.
   */
  quarantined: boolean;
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
 * `E11000` against the unique index on `eventId`), and translating it here keeps
 * driver error codes out of route handlers.
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
  /** Record an event durably. Idempotent per `event.id`. */
  enqueue(
    event: DomainEvent,
  ): Effect.Effect<OutboxEnqueueResult, EntifixConnError>;
  /**
   * Unsent, un-quarantined entries, oldest first — the relay's input.
   *
   * Excluding the quarantined ones here rather than in the relay is deliberate:
   * a skip the caller has to remember is a skip the next caller forgets.
   */
  pending(
    limit: number,
  ): Effect.Effect<readonly OutboxEntry[], EntifixConnError>;
  /**
   * Mark an entry published. A crash between the publish and this call re-sends
   * the event on the next drain, which is why delivery is at-least-once and why
   * a consumer that must not fold twice dedupes on `event.id`.
   */
  markSent(entry: OutboxEntry): Effect.Effect<void, EntifixConnError>;
  /**
   * Record a failed publish: increments `attempts` and stores `error`.
   *
   * `quarantine` is the caller's decision rather than the adapter's, because
   * the ceiling is configuration the relay reads and the store has no business
   * knowing it. Once set, {@link pending} must stop returning the entry — that
   * is the whole mechanism by which the queue's head moves.
   */
  recordFailure(
    entry: OutboxEntry,
    error: string,
    quarantine: boolean,
  ): Effect.Effect<void, EntifixConnError>;
}

export class TransactionOutboxTag extends Context.Tag('TransactionOutboxTag')<
  TransactionOutboxTag,
  TransactionOutbox
>() {}
