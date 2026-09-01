import { EntifixConnError } from '@r10c/entifix-ts-core';
import * as amqp from 'amqplib';
import { Context, Effect, Layer } from 'effect';

/** The fanout exchange every transaction event is broadcast through. */
export const TRANSACTION_EXCHANGE = 'entifix.transactions';

/** Re-establishes a consumer against a freshly opened channel. */
export type AmqpConsumerSetup = (channel: amqp.Channel) => Promise<void>;

/**
 * A RabbitMQ connection that survives the broker going away.
 *
 * This is not a convenience. `amqplib` does not reconnect: a connection opened
 * at boot and held in a `Layer` is dead permanently once the broker restarts,
 * and both halves of the bus die with it — publishes fail forever, and the saga
 * tracker's consumer stops folding events without ever erroring again. The
 * transactional outbox makes an event durable, but durability is worthless if
 * nothing can ever carry it, so the transport has to heal itself.
 */
export interface AmqpConnector {
  /**
   * Run `use` against a live channel, opening or reopening one as needed. Retries
   * once on a broken channel so a publish that races a broker restart succeeds
   * rather than surfacing an error the caller cannot act on.
   */
  withChannel<A>(use: (channel: amqp.Channel) => Promise<A>): Promise<A>;
  /**
   * Register a consumer, and re-register it after every reconnect. The setup is
   * re-run against the new channel, which is what makes a subscriber survive an
   * outage — its exclusive queue died with the old connection.
   */
  addConsumer(setup: AmqpConsumerSetup): Promise<void>;
}

/** DI tag carrying the self-healing connection (closed on release). */
export class AmqpChannelTag extends Context.Tag('AmqpChannelTag')<
  AmqpChannelTag,
  AmqpConnector
>() {}

export interface AmqpSettings {
  readonly uri: string;
}

interface Live {
  connection: amqp.ChannelModel;
  channel: amqp.Channel;
}

/**
 * A registered consumer and the channel it is currently bound to.
 *
 * Tracking the channel is what makes binding idempotent. Without it, a consumer
 * registered while the first connection is opening is run twice — once by the
 * open itself and once by `addConsumer` — and a doubly-bound subscriber folds
 * every event twice.
 */
interface Consumer {
  setup: AmqpConsumerSetup;
  boundTo?: amqp.Channel;
}

/**
 * Builds the connector. Exported for the specs; services take it from the layer.
 */
export const makeAmqpConnector = (uri: string) => {
  let live: Live | undefined;
  let opening: Promise<Live> | undefined;
  let closed = false;
  const consumers: Consumer[] = [];

  /** Bind every consumer that is not already bound to this channel. */
  const bindAll = async (channel: amqp.Channel) => {
    for (const consumer of consumers) {
      if (consumer.boundTo !== channel) {
        await consumer.setup(channel);
        consumer.boundTo = channel;
      }
    }
  };

  const open = async (): Promise<Live> => {
    const connection = await amqp.connect(uri);
    const channel = await connection.createChannel();
    await channel.assertExchange(TRANSACTION_EXCHANGE, 'fanout', {
      durable: true,
    });

    // Forget this connection the moment it breaks, so the next call reopens
    // instead of writing into a dead socket. The handlers are also what keep an
    // 'error' event from reaching Node's default handler and killing the
    // process — an unhandled 'error' on an amqplib connection is fatal.
    const drop = () => {
      if (live?.connection === connection) {
        live = undefined;
      }
    };
    connection.on('close', drop);
    connection.on('error', drop);
    channel.on('close', drop);
    channel.on('error', drop);

    live = { connection, channel };

    // Re-arm every subscriber against the new channel. Nothing else does this:
    // the queues they were consuming from went away with the old connection.
    await bindAll(channel);
    return live;
  };

  const ensure = async (): Promise<Live> => {
    if (closed) {
      throw new Error('AMQP connector is closed');
    }
    if (live) {
      return live;
    }
    // One open at a time: a burst of publishes after an outage would otherwise
    // race and leave orphaned connections behind, each with its own consumers.
    opening ??= open().finally(() => {
      opening = undefined;
    });
    return opening;
  };

  const connector: AmqpConnector = {
    withChannel: async use => {
      try {
        return await use((await ensure()).channel);
      } catch (error) {
        if (closed) {
          throw error;
        }
        // The channel may have died between `ensure` and `use`. Drop it and try
        // once more; a second failure is a real failure.
        live = undefined;
        return use((await ensure()).channel);
      }
    },
    addConsumer: async setup => {
      consumers.push({ setup });
      // `ensure` may have bound it already, if it opened a connection for this
      // very call — `bindAll` is what makes running it twice impossible.
      await bindAll((await ensure()).channel);
    },
  };

  const close = async () => {
    closed = true;
    const current = live;
    live = undefined;
    await current?.connection.close().catch(() => undefined);
  };

  return { connector, close };
};

/**
 * A scoped {@link Layer} that provides a self-healing RabbitMQ connection and
 * closes it on release. The exchange is asserted on every (re)connect, so
 * publishers and subscribers can always assume it exists.
 *
 * Connecting is **eager**, so a broker that is unreachable at boot still fails
 * the service's startup exactly as it did before — a service silently starting
 * without its bus would be a worse trade than the reconnection buys.
 */
export const AmqpLayer = (
  settings: AmqpSettings,
): Layer.Layer<AmqpChannelTag, EntifixConnError> =>
  Layer.scoped(
    AmqpChannelTag,
    Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const built = makeAmqpConnector(settings.uri);
          await built.connector.withChannel(async () => undefined);
          return built;
        },
        catch: error =>
          new EntifixConnError('Failed to connect to RabbitMQ', error),
      }),
      built => Effect.promise(() => built.close()),
    ).pipe(Effect.map(built => built.connector)),
  );
