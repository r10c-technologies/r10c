import { type EventBus, EventBusTag } from '@r10c/entifix-transactions';
import {
  EntifixConnError,
  makeEventEnvelope,
  readEventEnvelope,
} from '@r10c/entifix-ts-core';
import type { ConsumeMessage } from 'amqplib';
import { Effect, Layer } from 'effect';

import {
  AmqpChannelTag,
  type AmqpConnector,
  EVENTS_EXCHANGE,
} from '../amqp-connection/amqp-connection';

/**
 * RabbitMQ-backed {@link EventBus}. Events go out as `event` envelopes on the
 * shared topic exchange — the adapter owns the wire framing, so the port stays
 * event-typed.
 *
 * **The event's own name is the routing key**, which is what lets a subscriber
 * bind the exact pattern it declared in `tools/slices/*.slice.ts`. Each
 * subscriber still gets its own exclusive queue, so two replicas of one service
 * both see every matching event — a shared queue would deliver each event to
 * one of them, which reads as flakiness rather than as a design.
 *
 * Both methods go through the {@link AmqpConnector} rather than holding a
 * channel, because a channel does not survive the broker restarting. `publish`
 * asks for a live one per call, and `subscribe` registers its setup so the
 * connector can re-run it against the new channel after a reconnect — its
 * exclusive queue died with the old connection.
 */
export const makeAmqpEventBus = (connector: AmqpConnector): EventBus => ({
  publish: event =>
    Effect.tryPromise({
      try: () =>
        connector.withChannel(async channel => {
          channel.publish(
            EVENTS_EXCHANGE,
            event.name,
            Buffer.from(JSON.stringify(makeEventEnvelope(event))),
            { persistent: true },
          );
        }),
      catch: error =>
        new EntifixConnError('AMQP publish failed', error, {
          eventId: event.id,
          name: event.name,
        }),
    }),

  subscribe: (pattern, handler) =>
    Effect.tryPromise({
      try: () =>
        connector.addConsumer(async channel => {
          // One unacked message at a time: events for a transaction are then
          // folded serially (never concurrently), so an `accepted`/`completed`
          // pair can't race into two upserts.
          await channel.prefetch(1);
          const { queue } = await channel.assertQueue('', { exclusive: true });
          await channel.bindQueue(queue, EVENTS_EXCHANGE, pattern);
          await channel.consume(queue, (message: ConsumeMessage | null) => {
            if (message === null) {
              return;
            }
            const parsed: unknown = JSON.parse(message.content.toString());
            // The handler carries no requirements (the manager closes over its
            // store), so it runs standalone; ack on success, dead-letter on
            // failure.
            void Effect.runPromise(
              readEventEnvelope(parsed).pipe(Effect.flatMap(handler)),
            ).then(
              () => channel.ack(message),
              () => channel.nack(message, false, false),
            );
          });
        }),
      catch: error =>
        new EntifixConnError('AMQP subscribe failed', error, { pattern }),
    }),
});

/** Provides {@link EventBusTag} from an {@link AmqpChannelTag}. */
export const AmqpEventBusLayer = Layer.effect(
  EventBusTag,
  Effect.map(AmqpChannelTag, makeAmqpEventBus),
);
