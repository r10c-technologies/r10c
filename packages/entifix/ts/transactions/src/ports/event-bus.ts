import type {
  DomainEvent,
  EntifixConnError,
  EntifixError,
} from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/**
 * How a subscriber's queue is shaped, which is a property of the *workload*
 * rather than of the transport (ADR 0030).
 *
 * - `work` — a named, durable queue that survives the consumer's restart and
 *   accumulates while it is gone. Replicas share it, so each message reaches
 *   exactly one of them. A projection writer, a fold and a settlement consumer
 *   all want this.
 * - `broadcast` — a connection-scoped exclusive queue, so every replica
 *   receives every message and nothing is retained across a restart. Correct
 *   only when the replicas differ from one another — a socket push holding
 *   different clients per process.
 *
 * ADR 0029 built the exclusive queue for every subscriber and gave a stated
 * reason: a shared queue delivers each event to one replica, "which reads as
 * flakiness rather than as a design". That reasoning is right for `broadcast`
 * and wrong for `work`; it picked broadcast semantics for a workload that is
 * work, at a time when the only subscriber made the difference invisible.
 */
export type SubscriptionMode = 'work' | 'broadcast';

/**
 * A subscriber's declared interest, together with the delivery policy the
 * broker enforces for it.
 *
 * The shape mirrors `subscriptions` in `tools/slices/*.slice.ts`, so "how does
 * this fail" is answered where it can be checked rather than in a review
 * comment.
 */
export interface Subscription {
  /**
   * The **subscribing** slice — the `tools/slices/` key, and half of the queue
   * name.
   *
   * Deliberately not `EventSourceTag`, which is the *emitting* slice: one
   * deployment hosts several slices (ADR 0021 co-deploys `transaction` inside
   * marketplace-admin-service), so a process-wide "my slice" would attribute a
   * consumer's queue to whichever slice happened to publish from the same
   * process.
   */
  readonly slice: string;
  /**
   * The event name pattern, used verbatim as the broker's binding —
   * `transaction.*`, `catalog.published`. Filtering in the handler instead is
   * what this exists to prevent: it makes every consumer pay for every
   * publisher's traffic, and it puts the routing rule where no register can
   * check it.
   */
  readonly pattern: string;
  readonly mode: SubscriptionMode;
  /**
   * How many times the broker may deliver a message before dead-lettering it.
   *
   * Enforced by the queue itself rather than by logic each consumer
   * reimplements, so it applies to a redelivery after a crash as well as to one
   * after a nack. `broadcast` queues have no dead-letter path, so the value is
   * carried but unenforced there.
   */
  readonly maxAttempts: number;
}

/**
 * The domain event bus (RabbitMQ in `entifix-ts-amqp-client`). Services publish
 * what happened; interested slices subscribe to the names they declared.
 *
 * Typed on {@link DomainEvent} rather than on any one publisher's payload: a bus
 * that only knew `TransactionEvent` had nothing for ADR 0009's catalog
 * publication to travel in, which would have meant a second framing and a second
 * transport for the same job.
 *
 * The port stays event-typed rather than envelope-typed — the adapter owns the
 * wire framing — so a handler receives the message and its metadata without
 * ever seeing the envelope that carried them.
 */
export interface EventBus {
  publish(event: DomainEvent): Effect.Effect<void, EntifixConnError>;
  /**
   * Register a consumer for the events matching `subscription.pattern`.
   *
   * The returned Effect completes once the subscription is established; the
   * handler then runs per delivered event. Delivery is at-least-once, so a
   * handler that is not idempotent must deduplicate on `event.id`.
   *
   * A handler failure is **transient**: the adapter requeues it and the broker
   * counts the redelivery against `maxAttempts`, dead-lettering at the limit. A
   * payload the adapter cannot read is **poison** and is quarantined with zero
   * retries — a message that cannot be deserialized never becomes
   * deserializable, and retrying it only spends the budget of the messages
   * behind it. A *business* failure is neither: that message was processed
   * successfully and already produced its own event (ADR 0030).
   */
  subscribe(
    subscription: Subscription,
    handler: (event: DomainEvent) => Effect.Effect<void, EntifixError>,
  ): Effect.Effect<void, EntifixConnError>;
}

export class EventBusTag extends Context.Tag('EventBusTag')<
  EventBusTag,
  EventBus
>() {}
