import {
  type EventBus,
  EventBusTag,
  makeTransactionEventEnvelope,
  readTransactionEventEnvelope,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import type { ConsumeMessage } from 'amqplib';
import { Effect, Layer } from 'effect';

import {
  AmqpChannelTag,
  type AmqpConnector,
  TRANSACTION_EXCHANGE,
} from '../amqp-connection/amqp-connection';

/**
 * RabbitMQ-backed {@link EventBus}. Events go out as `transactionEvent`
 * envelopes on the fanout exchange — the adapter owns the wire framing, so the
 * port stays event-typed. Each subscriber binds its own exclusive queue, so the
 * saga tracker receives a full broadcast of every service's events.
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
            TRANSACTION_EXCHANGE,
            '',
            Buffer.from(JSON.stringify(makeTransactionEventEnvelope(event))),
            { persistent: true },
          );
        }),
      catch: error =>
        new EntifixConnError('AMQP publish failed', error, {
          transactionId: event.transactionId,
        }),
    }),

  subscribe: handler =>
    Effect.tryPromise({
      try: () =>
        connector.addConsumer(async channel => {
          // One unacked message at a time: events for a transaction are then
          // folded serially (never concurrently), so an `accepted`/`completed`
          // pair can't race into two upserts.
          await channel.prefetch(1);
          const { queue } = await channel.assertQueue('', { exclusive: true });
          await channel.bindQueue(queue, TRANSACTION_EXCHANGE, '');
          await channel.consume(queue, (message: ConsumeMessage | null) => {
            if (message === null) {
              return;
            }
            const parsed: unknown = JSON.parse(message.content.toString());
            // The handler carries no requirements (the manager closes over its
            // store), so it runs standalone; ack on success, dead-letter on
            // failure.
            void Effect.runPromise(
              readTransactionEventEnvelope(parsed).pipe(
                Effect.flatMap(handler),
              ),
            ).then(
              () => channel.ack(message),
              () => channel.nack(message, false, false),
            );
          });
        }),
      catch: error => new EntifixConnError('AMQP subscribe failed', error),
    }),
});

/** Provides {@link EventBusTag} from an {@link AmqpChannelTag}. */
export const AmqpEventBusLayer = Layer.effect(
  EventBusTag,
  Effect.map(AmqpChannelTag, makeAmqpEventBus),
);
