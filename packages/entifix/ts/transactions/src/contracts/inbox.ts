import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/**
 * A consumer's claim on one delivered message.
 *
 * The mirror of an {@link OutboxEntry}: the outbox makes a publisher's event
 * survive a broker outage, the inbox makes a consumer's side effect survive a
 * redelivery. Each end owns one unique index, and the value in it is the same
 * `event.id`.
 */
export interface InboxClaim {
  /**
   * Which consumer claimed it — the subscription's durable work-queue name
   * (`<slice>.<pattern>`).
   *
   * **Half of the key, and the half that is easy to leave out.** Two consumers
   * legitimately process the same event: the saga tracker's fold and the SSE
   * hub both bind `transaction.*` today. Keyed on `eventId` alone, whichever
   * claimed first would starve the other of every message — a consumer that
   * silently stops working while the broker, the queue and the handler all
   * report success.
   */
  consumer: string;
  /**
   * The message's own id, which for a transaction step is
   * `<transactionId>:<step>`.
   *
   * Never `correlationId`: one transaction emits up to three messages, so
   * keying on the correlation id would make `completed` look like a
   * redelivery of `accepted` (ADR 0029).
   */
  eventId: string;
  /** ISO-8601, for retention — nothing reads it to make a decision. */
  claimedAt: string;
}

/**
 * Whether {@link TransactionInbox.claim} actually wrote.
 *
 * `duplicate` is not a failure — it is how a **redelivery** is recognised, the
 * same way `OutboxEnqueueResult`'s `duplicate` recognises a replayed command.
 * Delivery is at-least-once by construction (a crash between `publish` and
 * `markSent` re-sends), so a consumer seeing this should skip its side effect
 * and ack, not error.
 */
export type InboxClaimResult = 'claimed' | 'duplicate';

/**
 * The consumer-side half of exactly-once processing over an at-least-once bus.
 *
 * A claim is only worth anything if it is written **in the same storage
 * transaction as the side effect it guards**. Claim-then-act leaves a crash
 * window in which the claim is taken and the effect never ran, so the
 * redelivery is skipped and the work is lost — strictly worse than doing it
 * twice.
 *
 * There is deliberately **no `claimWithin(session)` here**, for the reason
 * {@link TransactionOutbox} states about `enqueueWithin`: a driver session may
 * not enter a framework-free contract. The consumer owns that write, exactly as
 * a {@link TransactionHandler} owns the `completed` outbox entry — it holds the
 * session, it inserts the document {@link InboxClaim} describes, and this port
 * is what a consumer that can claim standalone uses instead.
 *
 * It follows that **the inbox lives with the side effect, not in one central
 * place**: the claim and the write must be in the same database to be one fact.
 * The outbox is per-tenant because the entity is; the saga tracker's inbox is in
 * the `saga` database because that is where its fold writes.
 */
export interface TransactionInbox {
  /**
   * Claim an event for this consumer. Idempotent per `(consumer, eventId)`.
   *
   * Answering `duplicate` means some earlier delivery already ran the side
   * effect to completion, because the claim and the effect commit together.
   */
  claim(eventId: string): Effect.Effect<InboxClaimResult, EntifixConnError>;
}

export class TransactionInboxTag extends Context.Tag('TransactionInboxTag')<
  TransactionInboxTag,
  TransactionInbox
>() {}
