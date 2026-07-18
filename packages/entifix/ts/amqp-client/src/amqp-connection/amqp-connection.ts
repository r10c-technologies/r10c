import { EntifixConnError } from '@r10c/entifix-ts-core';
import * as amqp from 'amqplib';
import { Context, Effect, Layer } from 'effect';

/** The fanout exchange every transaction event is broadcast through. */
export const TRANSACTION_EXCHANGE = 'entifix.transactions';

/** DI tag carrying an open AMQP channel (its connection closed on release). */
export class AmqpChannelTag extends Context.Tag('AmqpChannelTag')<
  AmqpChannelTag,
  amqp.Channel
>() {}

export interface AmqpSettings {
  readonly uri: string;
}

/**
 * A scoped {@link Layer} that opens a RabbitMQ connection + channel on acquire,
 * asserts the shared fanout exchange, and closes the connection on release.
 * Asserting here (once) means publishers and subscribers can assume it exists.
 */
export const AmqpLayer = (
  settings: AmqpSettings,
): Layer.Layer<AmqpChannelTag, EntifixConnError> =>
  Layer.scoped(
    AmqpChannelTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const connection = await amqp.connect(settings.uri);
          const channel = await connection.createChannel();
          await channel.assertExchange(TRANSACTION_EXCHANGE, 'fanout', {
            durable: true,
          });
          return { connection, channel };
        },
        catch: (error) =>
          new EntifixConnError('Failed to connect to RabbitMQ', error),
      }),
      ({ connection }) =>
        Effect.promise(() =>
          connection.close().catch(() => undefined),
        ),
    ).pipe(Effect.map(({ channel }) => channel)),
  );
