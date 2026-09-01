import type { DomainEvent } from '@r10c/entifix-ts-core';
import { describeEventBusContract } from '@r10c/entifix-ts-testing-unit/contracts';
import { makeFakeAmqpChannel } from '@r10c/entifix-ts-testing-unit/drivers';
import type { Channel } from 'amqplib';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { AmqpConnector } from '../amqp-connection/amqp-connection.js';
import { makeAmqpEventBus } from './amqp-event-bus.js';

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
 * The bus runs against a fake amqplib channel, so the envelope framing, the
 * `prefetch(1)`, and the ack/nack policy are the real adapter's.
 */
const withFakeChannel = () => {
  const fake = makeFakeAmqpChannel();
  return {
    fake,
    bus: makeAmqpEventBus(connectorFor(fake.channel as Channel)),
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

  it('binds its exclusive queue to the pattern it was given', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(ANY_TRANSACTION, () => Effect.void));

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

    await Effect.runPromise(bus.subscribe(ANY_TRANSACTION, () => Effect.void));

    // An accepted/completed pair delivered concurrently would otherwise upsert
    // twice for the same transaction.
    expect(fake.prefetchCount).toBe(1);
  });

  it('acks a message its handler accepted', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(ANY_TRANSACTION, () => Effect.void));

    await fake.deliver(anEnvelope(anEvent()));

    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  it('discards a message whose handler failed', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(ANY_TRANSACTION, () =>
        Effect.fail(new Error('handler failed') as never),
      ),
    );

    await fake.deliver(anEnvelope(anEvent()));

    // `nack(message, false, false)` — no requeue, so a poison message cannot
    // spin forever. Nothing catches it either: there is no dead-letter
    // exchange yet, so the message is discarded (ADR 0030, #177).
    expect(fake.nacked).toHaveLength(1);
    expect(fake.acked).toHaveLength(0);
  });

  it('discards a message that is not an event envelope', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(ANY_TRANSACTION, () => Effect.void));

    await fake.deliverRaw(JSON.stringify({ not: 'an envelope' }));

    expect(fake.nacked).toHaveLength(1);
  });

  it('ignores a broker cancellation delivered as a null message', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(ANY_TRANSACTION, () => Effect.void));

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
      bus.subscribe(ANY_TRANSACTION, () => Effect.void),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
