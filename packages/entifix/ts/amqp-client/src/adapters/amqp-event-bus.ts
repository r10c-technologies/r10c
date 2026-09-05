import {
  type EventBus,
  EventBusTag,
  type Subscription,
  type SubscriptionMode,
} from '@r10c/entifix-transactions';
import type { WiringRegistry } from '@r10c/entifix-ts-business';
import {
  ShutdownRegistryTag,
  WiringRegistryTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixConnError,
  makeEventEnvelope,
  readEventEnvelope,
} from '@r10c/entifix-ts-core';
import type { Channel, ConsumeMessage } from 'amqplib';
import { Duration, Effect, Layer } from 'effect';

import {
  AmqpChannelTag,
  type AmqpConnector,
  EVENTS_DLX,
  EVENTS_EXCHANGE,
} from '../amqp-connection/amqp-connection';

/** Appended to a work queue's name to make the queue that holds its failures. */
const QUARANTINE_SUFFIX = '.quarantine';

/**
 * How often the shutdown drain re-checks whether the handlers have finished.
 *
 * A poll rather than a latch because a delivery is started from amqplib's own
 * callback, outside any fiber this module holds; the drain's own bound is the
 * shutdown hook's, so this interval only decides how promptly the process
 * notices it is free to go.
 */
const DELIVERY_POLL = Duration.millis(25);

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
 *
 * It returns the bus **and** its `drainDeliveries`, rather than only the port:
 * waiting for in-flight handlers is an adapter fact — it is this module that
 * runs them — and putting it on `EventBus` would make every implementation of
 * a framework-free port carry a shutdown concern it has no deliveries to drain.
 */
export const makeAmqpEventBus = (
  connector: AmqpConnector,
  wiring: WiringRegistry,
): { bus: EventBus; drainDeliveries: Effect.Effect<void> } => {
  /**
   * Handlers started and not yet settled.
   *
   * Nothing tracked them before, so a SIGTERM killed them mid-flight and the
   * broker redelivered whatever was unacked — safe only while every consumer
   * happens to be idempotent, which is the assumption #178 stops making.
   */
  let inFlight = 0;

  const bus: EventBus = {
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
        // Recorded **after** the publish succeeds, so `GET /api/$service` reports
        // what this process actually put on the exchange. Recording the intent
        // instead would make the declared-vs-observed diff pass on a service whose
        // every publish is failing (ADR 0031).
      }).pipe(Effect.tap(() => wiring.recordPublish(event.name))),

    subscribe: (subscription, handler) =>
      Effect.tryPromise({
        try: () =>
          connector.addConsumer(async channel => {
            // One unacked message at a time: events for a transaction are then
            // folded serially (never concurrently), so an `accepted`/`completed`
            // pair can't race into two upserts.
            await channel.prefetch(1);
            const queue = await declareQueue(channel, subscription);
            await channel.bindQueue(
              queue,
              EVENTS_EXCHANGE,
              subscription.pattern,
            );
            // What the process **bound**, recorded at the point it bound it. The
            // registry deduplicates, so re-running this setup after a reconnect
            // does not double the entry.
            await Effect.runPromise(
              wiring.recordSubscription({
                slice: subscription.slice,
                pattern: subscription.pattern,
                mode: subscription.mode,
                queue,
              }),
            );
            const { consumerTag } = await channel.consume(
              queue,
              (message: ConsumeMessage | null) => {
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

                // Counted around the whole settle, so a shutdown waits for the ack
                // as well as the handler: cancelling a consumer stops *new*
                // deliveries and says nothing about this one.
                inFlight += 1;
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
                ).finally(() => {
                  inFlight -= 1;
                });
              },
            );
            return [consumerTag];
          }),
        catch: error =>
          new EntifixConnError('AMQP subscribe failed', error, {
            slice: subscription.slice,
            pattern: subscription.pattern,
          }),
      }),
  };

  return {
    bus,
    drainDeliveries: Effect.gen(function* () {
      while (inFlight > 0) {
        yield* Effect.sleep(DELIVERY_POLL);
      }
    }),
  };
};

/**
 * Provides {@link EventBusTag} from an {@link AmqpChannelTag}.
 *
 * It also takes {@link WiringRegistryTag}, which `makeServerLayer` provides once
 * per service — so the bus and `GET /api/$service` share one instance, and the
 * document reports the bindings this very process made.
 */
export const AmqpEventBusLayer = Layer.effect(
  EventBusTag,
  Effect.gen(function* () {
    const connector = yield* AmqpChannelTag;
    const wiring = yield* WiringRegistryTag;
    const shutdown = yield* ShutdownRegistryTag;
    const { bus, drainDeliveries } = makeAmqpEventBus(connector, wiring);

    // `stop-intake`, and both halves are it: cancelling stops the broker
    // handing over anything new, then the drain waits for the deliveries
    // already in progress. Registered here rather than in a service's `main.ts`
    // for the reason every registry in this repo exists — a service that gains
    // a bus gains its drain, with nothing to remember.
    yield* shutdown.register({
      name: 'amqp-consumers',
      phase: 'stop-intake',
      run: Effect.promise(() => connector.cancelConsumers()).pipe(
        Effect.andThen(drainDeliveries),
      ),
    });

    return bus;
  }),
);
