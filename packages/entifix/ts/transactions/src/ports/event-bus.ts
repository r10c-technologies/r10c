import type {
  DomainEvent,
  EntifixConnError,
  EntifixError,
} from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

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
   * Register a consumer for the events matching `pattern`.
   *
   * The pattern is the subscriber's declared interest from
   * `tools/slices/*.slice.ts` (`subscribedEvents`) — `transaction.*`,
   * `catalog.published` — used verbatim as the broker's binding. Filtering in
   * the handler instead is what this argument exists to prevent: it makes every
   * consumer pay for every publisher's traffic, and it puts the routing rule in
   * a place no register can check.
   *
   * The returned Effect completes once the subscription is established; the
   * handler then runs per delivered event. Delivery is at-least-once, so a
   * handler that is not idempotent must deduplicate on `event.id`. A handler
   * failure is the adapter's concern (nack/requeue policy).
   */
  subscribe(
    pattern: string,
    handler: (event: DomainEvent) => Effect.Effect<void, EntifixError>,
  ): Effect.Effect<void, EntifixConnError>;
}

export class EventBusTag extends Context.Tag('EventBusTag')<
  EventBusTag,
  EventBus
>() {}
