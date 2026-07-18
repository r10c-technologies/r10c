import type { EntifixConnError, EntifixError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { TransactionEvent } from '../contracts/event';

/**
 * The transaction event bus (RabbitMQ in `entifix-ts-amqp-client`). Services
 * publish lifecycle events; the `transaction-manager` subscribes. Deliberately
 * event-typed rather than envelope-typed — the adapter owns the envelope
 * framing on the wire.
 */
export interface EventBus {
  publish(event: TransactionEvent): Effect.Effect<void, EntifixConnError>;
  /**
   * Register a consumer. The returned Effect completes once the subscription is
   * established; the handler then runs per delivered event. A handler failure is
   * the adapter's concern (nack/requeue policy).
   */
  subscribe(
    handler: (event: TransactionEvent) => Effect.Effect<void, EntifixError>,
  ): Effect.Effect<void, EntifixConnError>;
}

export class EventBusTag extends Context.Tag('EventBusTag')<
  EventBusTag,
  EventBus
>() {}
