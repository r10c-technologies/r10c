import {
  type EventBus,
  EventBusTag,
  type Subscription,
  type SubscriptionMode,
} from '@r10c/entifix-transactions';
import {
  EntifixConnError,
  makeEventEnvelope,
  readEventEnvelope,
} from '@r10c/entifix-ts-core';
import type { Channel, ConsumeMessage } from 'amqplib';
import { Effect, Layer } from 'effect';

import {
  AmqpChannelTag,
  type AmqpConnector,
  EVENTS_DLX,
  EVENTS_EXCHANGE,
} from '../amqp-connection/amqp-connection';

/** Appended to a work queue's name to make the queue that holds its failures. */
const QUARANTINE_SUFFIX = '.quarantine';

/**
 * Why a delivery did not succeed, which is the whole of the nack decision.
 *
 * `transient` is a handler that threw — a dependency briefly gone, a timeout —
 * and is worth another delivery. `poison` is a payload this process cannot
 * read, and is worth **none**: a message that cannot be deserialized never
 * becomes deserializable, so retrying it only spends the delivery budget of the
 * messages queued behind it. Conflating the two is what the adapter did before
 * ADR 0030, on a queue that discarded both.
 *
 * A *business* failure is neither, and never reaches here: that message was
 * handled successfully and produced its own `failed` event.
 */
type DeliveryFailure = 'transient' | 'poison';

/**
 * The queue a subscription binds.
 *
 * `<subscribing slice>.<pattern>`, so the name says who is owed the messages in
 * it — readable in the broker's own UI, which is where someone looks when a
 * queue has depth. The slice is the *subscriber's*, never the publisher's:
 * `EventSourceTag` names the emitter, and one deployment hosts several slices
 * (ADR 0021 co-deploys `transaction` inside marketplace-admin-service), so
 * deriving from it would file a consumer's queue under whoever happened to
 * publish from the same process.
 *
 * `*` and `#` are spelled out because AMQP 0-9-1 restricts a queue name to
 * letters, digits, hyphen, underscore, period and colon. RabbitMQ is lenient in
 * practice, but the name also has to survive being a URL path segment in the
 * management API, and `%2A` in an operator's address bar is a poor trade for
 * three saved characters.
 */
export const queueNameFor = (subscription: Subscription): string =>
  `${subscription.slice}.${subscription.pattern
    .replaceAll('*', '_star_')
    .replaceAll('#', '_hash_')}`;

/**
 * Declares the queue a subscription consumes and returns its name.
 *
 * A **work** queue is durable and quorum-backed, so it survives the consumer's
 * restart and accumulates while it is gone — the hop ADR 0028's durability
 * chain was missing. Its retry ceiling is `x-delivery-limit`, a queue argument
 * rather than logic every consumer reimplements, so it also counts a
 * redelivery after a crash.
 *
 * The quarantine is declared **first**: a message dead-lettered the instant the
 * work queue exists must have somewhere to land, and a `direct` exchange with
 * no matching binding drops what it routes.
 *
 * `x-delivery-limit` is immutable once a queue exists. Re-declaring with a
 * different `maxAttempts` fails `PRECONDITION_FAILED` and closes the channel,
 * and there is no safe automatic recovery — so changing the ceiling means
 * deleting the queue, which locally is `pnpm run <app>:dev:reset`.
 */
const declareQueue = async (
  channel: Channel,
  subscription: Subscription,
): Promise<string> => {
  if (subscription.mode === 'broadcast') {
    // Connection-scoped and retained by nobody, which is right only when the
    // replicas differ from one another (#136's socket push). Unchanged from
    // what ADR 0029 built.
    const { queue } = await channel.assertQueue('', { exclusive: true });
    return queue;
  }

  const queue = queueNameFor(subscription);
  const quarantine = `${queue}${QUARANTINE_SUFFIX}`;

  await channel.assertQueue(quarantine, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(quarantine, EVENTS_DLX, queue);
  await channel.assertQueue(queue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': subscription.maxAttempts,
      'x-dead-letter-exchange': EVENTS_DLX,
      'x-dead-letter-routing-key': queue,
    },
  });

  return queue;
};

/**
 * Whether a failed delivery should go back on the queue.
 *
 * Only a transient failure on a **work** queue: there the broker counts the
 * redelivery against `x-delivery-limit` and dead-letters at the ceiling, so a
 * requeue is bounded. A broadcast queue has neither a ceiling nor a dead-letter
 * path, so requeueing there is an unbounded loop — the fault ADR 0029 named and
 * the reason its comment said not to.
 */
const requeues = (failure: DeliveryFailure, mode: SubscriptionMode): boolean =>
  failure === 'transient' && mode === 'work';

/**
 * RabbitMQ-backed {@link EventBus}. Events go out as `event` envelopes on the
 * shared topic exchange — the adapter owns the wire framing, so the port stays
 * event-typed.
 *
 * **The event's own name is the routing key**, which is what lets a subscriber
 * bind the exact pattern it declared in `tools/slices/*.slice.ts`.
 *
 * The queue a subscriber binds is its own choice of shape (ADR 0030). A `work`
 * subscription gets a named durable queue that replicas share and that keeps
 * accumulating while the consumer is down; a `broadcast` one gets the exclusive
 * queue ADR 0029 built, where every replica sees every event and nothing
 * survives a restart. Choosing broadcast for a workload that is work is how an
 * event published during a rollout is dropped by the broker while the outbox
 * has already recorded it sent.
 *
 * Both methods go through the {@link AmqpConnector} rather than holding a
 * channel, because a channel does not survive the broker restarting. `publish`
 * asks for a live one per call, and `subscribe` registers its setup so the
 * connector can re-run it against the new channel after a reconnect. A durable
 * queue outlives that reconnect; the consumer bound to it does not.
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

  subscribe: (subscription, handler) =>
    Effect.tryPromise({
      try: () =>
        connector.addConsumer(async channel => {
          // One unacked message at a time: events for a transaction are then
          // folded serially (never concurrently), so an `accepted`/`completed`
          // pair can't race into two upserts.
          await channel.prefetch(1);
          const queue = await declareQueue(channel, subscription);
          await channel.bindQueue(queue, EVENTS_EXCHANGE, subscription.pattern);
          await channel.consume(queue, (message: ConsumeMessage | null) => {
            if (message === null) {
              return;
            }

            // Reading the payload and running the handler are separated on
            // purpose: they fail for different reasons and earn different
            // treatment. `JSON.parse` is inside the Effect because it throws
            // *synchronously* — outside, it escaped into amqplib's callback and
            // the message was never even nacked.
            const settle = Effect.try({
              try: () => JSON.parse(message.content.toString()) as unknown,
              catch: (): DeliveryFailure => 'poison',
            }).pipe(
              Effect.flatMap(parsed =>
                readEventEnvelope(parsed).pipe(
                  Effect.mapError((): DeliveryFailure => 'poison'),
                ),
              ),
              // The handler carries no requirements (the subscriber closes over
              // its store), so it runs standalone.
              Effect.flatMap(event =>
                handler(event).pipe(
                  Effect.mapError((): DeliveryFailure => 'transient'),
                ),
              ),
            );

            void Effect.runPromise(
              settle.pipe(
                Effect.match({
                  onSuccess: () => channel.ack(message),
                  onFailure: failure =>
                    channel.nack(
                      message,
                      false,
                      requeues(failure, subscription.mode),
                    ),
                }),
              ),
            );
          });
        }),
      catch: error =>
        new EntifixConnError('AMQP subscribe failed', error, {
          slice: subscription.slice,
          pattern: subscription.pattern,
        }),
    }),
});

/** Provides {@link EventBusTag} from an {@link AmqpChannelTag}. */
export const AmqpEventBusLayer = Layer.effect(
  EventBusTag,
  Effect.map(AmqpChannelTag, makeAmqpEventBus),
);
