import { EventBusTag, type Subscription } from '@r10c/entifix-transactions';
import type {
  BoundSubscription,
  WiringRegistry,
} from '@r10c/entifix-ts-business';
import { WiringRegistryTag } from '@r10c/entifix-ts-business';
import type { DomainEvent } from '@r10c/entifix-ts-core';
import { describeEventBusContract } from '@r10c/entifix-ts-testing-unit/contracts';
import { makeFakeAmqpChannel } from '@r10c/entifix-ts-testing-unit/drivers';
import type { Channel } from 'amqplib';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AmqpConnector } from '../amqp-connection/amqp-connection.js';
import { AmqpChannelTag } from '../amqp-connection/amqp-connection.js';
import {
  AmqpEventBusLayer,
  makeAmqpEventBus,
  queueNameFor,
} from './amqp-event-bus.js';

/**
 * A connector that always hands back the same fake channel. The bus asks for a
 * channel per call now (a held one does not survive a broker restart), so the
 * doubles have to supply that indirection — the reconnect behaviour itself is
 * covered in `amqp-connection.spec.ts`.
 */
const connectorFor = (channel: Channel): AmqpConnector => ({
  withChannel: use => use(channel),
  addConsumer: setup => setup(channel),
});

/** What the tracker binds, and what the contract harness subscribes with. */
const ANY_TRANSACTION = 'transaction.*';

/** The tracker's own subscription: a durable queue it must not lose events from. */
const WORK: Subscription = {
  slice: 'transaction',
  pattern: ANY_TRANSACTION,
  mode: 'work',
  maxAttempts: 5,
};

/** The same interest, shaped for a consumer every replica must receive (#136). */
const BROADCAST: Subscription = { ...WORK, mode: 'broadcast' };

/** What `WORK` resolves to, spelled once so the expectations agree. */
const WORK_QUEUE = 'transaction.transaction._star_';

const anEvent = (id = 'tx-1:accepted'): DomainEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: 'tx-1',
  data: { transactionId: 'tx-1', entity: 'product', step: 'accepted' },
});

/** The envelope the adapter puts on the wire for `event`. */
const anEnvelope = (event: DomainEvent) => {
  const { data, ...meta } = event;
  return { meta: { type: 'event', event: meta }, data };
};

/**
 * A wiring registry that just remembers, so a case can assert what the adapter
 * recorded without standing up the real `Ref`-backed layer.
 */
const recordingWiring = () => {
  const subscriptions: BoundSubscription[] = [];
  const published: string[] = [];
  const registry: WiringRegistry = {
    recordSubscription: bound =>
      Effect.sync(() => {
        subscriptions.push(bound);
      }),
    recordPublish: name =>
      Effect.sync(() => {
        published.push(name);
      }),
    subscriptions: Effect.sync(() => subscriptions),
    published: Effect.sync(() => published),
  };
  return { registry, subscriptions, published };
};

/**
 * The bus runs against a fake amqplib channel, so the envelope framing, the
 * `prefetch(1)`, and the ack/nack policy are the real adapter's.
 */
const withFakeChannel = () => {
  const fake = makeFakeAmqpChannel();
  const wiring = recordingWiring();
  return {
    fake,
    wiring,
    bus: makeAmqpEventBus(
      connectorFor(fake.channel as Channel),
      wiring.registry,
    ),
  };
};

describeEventBusContract('amqp adapter over a fake channel', async () => {
  const { fake, bus } = withFakeChannel();
  // Subscribers are registered lazily by the contract; publishing goes out as
  // an envelope, so `published` unwraps it back into the event. The fake routes
  // by the binding, so the contract's non-matching case exercises the real
  // `bindQueue` pattern rather than a stub that fans out to everyone.
  return {
    bus,
    deliver: event => fake.deliver(anEnvelope(event)),
    published: () =>
      fake.published.map(message => {
        const body = message.body as {
          meta: { event: Omit<DomainEvent, 'data'> };
          data: unknown;
        };
        return { ...body.meta.event, data: body.data };
      }),
  };
});

describe('makeAmqpEventBus', () => {
  it('frames events as event envelopes, splitting metadata from payload', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(fake.published[0]?.body).toEqual(anEnvelope(anEvent()));
  });

  // The routing key is the whole point of the topic exchange: it is what lets a
  // subscriber declare its interest to the broker instead of filtering in its
  // own handler.
  it('publishes under the event’s own name as the routing key', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(fake.published[0]?.routingKey).toBe('transaction.accepted');
  });

  it('names a work queue after the subscribing slice and its pattern', () => {
    expect(queueNameFor(WORK)).toBe(WORK_QUEUE);
    // `#` too, because a name a broker accepts is not the same as one that
    // survives being a URL path segment in the management API.
    expect(queueNameFor({ ...WORK, pattern: 'catalog.#' })).toBe(
      'transaction.catalog._hash_',
    );
  });

  it('declares a work queue that outlives the consumer, with a delivery ceiling', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // Durable and quorum-backed, so an event published while this consumer is
    // restarting is still there when it comes back — the hop ADR 0028's
    // durability chain was missing. The ceiling is a queue argument, so the
    // broker counts a redelivery after a crash as well as one after a nack.
    expect(fake.queues).toContainEqual({
      queue: WORK_QUEUE,
      options: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-delivery-limit': 5,
          'x-dead-letter-exchange': 'entifix.events.dlx',
          'x-dead-letter-routing-key': WORK_QUEUE,
        },
      },
    });
  });

  it('declares the quarantine before the queue that dead-letters into it', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // Order matters: a `direct` exchange drops what it cannot route, so a
    // message dead-lettered the instant the work queue exists must already
    // have somewhere to land.
    expect(fake.queues.map(queue => queue.queue)).toEqual([
      `${WORK_QUEUE}.quarantine`,
      WORK_QUEUE,
    ]);
    expect(fake.bindings).toEqual([
      {
        queue: `${WORK_QUEUE}.quarantine`,
        exchange: 'entifix.events.dlx',
        pattern: WORK_QUEUE,
      },
      {
        queue: WORK_QUEUE,
        exchange: 'entifix.events',
        pattern: ANY_TRANSACTION,
      },
    ]);
  });

  it('keeps a broadcast subscription on the exclusive queue ADR 0029 built', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(BROADCAST, () => Effect.void));

    // No name, no durability, no dead-letter path: every replica receives
    // every event and nothing is retained. Right only when the replicas
    // genuinely differ, which is #136's socket push and nothing else today.
    expect(fake.queues).toEqual([
      { queue: 'amq.gen-fake', options: { exclusive: true } },
    ]);
    expect(fake.bindings).toEqual([
      {
        queue: 'amq.gen-fake',
        exchange: 'entifix.events',
        pattern: ANY_TRANSACTION,
      },
    ]);
  });

  it('asks for prefetch(1), without which the manager’s fold races', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    // An accepted/completed pair delivered concurrently would otherwise upsert
    // twice for the same transaction.
    expect(fake.prefetchCount).toBe(1);
  });

  it('acks a message its handler accepted', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliver(anEnvelope(anEvent()));

    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  it('requeues a transient handler failure so the broker counts it', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(WORK, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    // `requeue: true` is what hands the retry to the broker: it increments the
    // delivery count and dead-letters at `x-delivery-limit`. Requeueing is
    // bounded *because* the ceiling exists — before it, this was an infinite
    // loop, which is why the old adapter discarded instead.
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: true },
    ]);
    expect(fake.acked).toHaveLength(0);
  });

  it('quarantines a poison payload without spending a single retry', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverRaw(JSON.stringify({ not: 'an envelope' }));

    // `requeue: false` goes straight to the dead-letter exchange. A payload
    // `readEventEnvelope` rejects never becomes readable, so retrying it only
    // spends the budget of the messages behind it.
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: false },
    ]);
  });

  it('quarantines a payload that is not even JSON', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverRaw('not json at all');

    // `JSON.parse` throws synchronously. Outside the Effect it escaped into
    // amqplib's callback and the message was never nacked at all — a third
    // poison class the adapter used to have no path for.
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: false },
    ]);
  });

  it('does not requeue a broadcast failure, which nothing would ever stop', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(BROADCAST, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    // An exclusive queue has neither a delivery limit nor a dead-letter
    // exchange, so a requeue there is an unbounded loop rather than a bounded
    // retry. The message is dropped, which is the cost of broadcast semantics
    // and the reason a work consumer must not choose them.
    expect(fake.nacked).toEqual([
      { message: expect.anything(), allUpTo: false, requeue: false },
    ]);
  });

  it('ignores a broker cancellation delivered as a null message', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    await fake.deliverCancellation();

    expect(fake.acked).toHaveLength(0);
    expect(fake.nacked).toHaveLength(0);
  });

  it('maps a publish failure onto EntifixConnError', async () => {
    const { fake, bus } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    const exit = await Effect.runPromiseExit(bus.publish(anEvent()));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('maps a subscribe failure onto EntifixConnError', async () => {
    const { fake, bus } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    const exit = await Effect.runPromiseExit(
      bus.subscribe(WORK, () => Effect.void),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  /**
   * ADR 0031 — what the process actually did, recorded where it did it. A source
   * scan cannot see emission, which is why `tools/slices/` has been able to
   * declare `catalog.published` with nothing publishing it.
   */
  it('records the event names it published', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(wiring.published).toEqual(['transaction.accepted']);
  });

  // Recorded after the publish succeeds. Recording the intent instead would let
  // the diff pass for a service whose every publish is failing.
  it('records nothing when the publish fails', async () => {
    const { fake, bus, wiring } = withFakeChannel();
    fake.failWith(new Error('channel closed'));

    await Effect.runPromiseExit(bus.publish(anEvent()));

    expect(wiring.published).toEqual([]);
  });

  it('records the queue a subscription bound, with its mode', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(WORK, () => Effect.void));

    expect(wiring.subscriptions).toEqual([
      {
        slice: 'transaction',
        pattern: ANY_TRANSACTION,
        mode: 'work',
        queue: WORK_QUEUE,
      },
    ]);
  });

  // A broadcast queue is named by the broker, so the recorded name is whatever
  // `assertQueue('')` came back with — which is what an operator needs to find
  // it in the management UI.
  it('records the generated name of a broadcast queue', async () => {
    const { bus, wiring } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(BROADCAST, () => Effect.void));

    expect(wiring.subscriptions[0]?.mode).toBe('broadcast');
    expect(wiring.subscriptions[0]?.queue).not.toBe(WORK_QUEUE);
  });
});

describe('AmqpEventBusLayer', () => {
  // The layer takes both tags because the registry it records into has to be the
  // instance `makeServerLayer` provided — a second one would be written to by
  // the bus and read by nobody.
  it('builds a bus from the connector and the wiring registry', async () => {
    const fake = makeFakeAmqpChannel();
    const wiring = recordingWiring();

    await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBusTag;
        yield* bus.publish(anEvent());
      }).pipe(
        Effect.provide(
          AmqpEventBusLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  AmqpChannelTag,
                  connectorFor(fake.channel as Channel),
                ),
                Layer.succeed(WiringRegistryTag, wiring.registry),
              ),
            ),
          ),
        ),
      ),
    );

    expect(wiring.published).toEqual(['transaction.accepted']);
  });
});
