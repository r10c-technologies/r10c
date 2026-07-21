import type { TransactionEvent } from '@r10c/entifix-transactions';
import { describeEventBusContract } from '@r10c/entifix-ts-testing-unit/contracts';
import { makeFakeAmqpChannel } from '@r10c/entifix-ts-testing-unit/drivers';
import type { Channel } from 'amqplib';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeAmqpEventBus } from './amqp-event-bus.js';

const anEvent = (transactionId = 'tx-1'): TransactionEvent => ({
  transactionId,
  entity: 'product',
  state: 'PENDING',
  step: 'accepted',
  at: '2026-01-01T00:00:00.000Z',
});

/**
 * The bus runs against a fake amqplib channel, so the envelope framing, the
 * `prefetch(1)`, and the ack/nack policy are the real adapter's.
 */
const withFakeChannel = () => {
  const fake = makeFakeAmqpChannel();
  return { fake, bus: makeAmqpEventBus(fake.channel as Channel) };
};

describeEventBusContract('amqp adapter over a fake channel', async () => {
  const { fake, bus } = withFakeChannel();
  // Subscribers are registered lazily by the contract; publishing goes out as
  // an envelope, so `published` unwraps it back into the event.
  return {
    bus,
    deliver: (event) =>
      fake.deliver({
        meta: { type: 'transactionEvent', entity: event.entity },
        data: event,
      }),
    published: () =>
      fake.published.map(
        (message) => (message.body as { data: TransactionEvent }).data,
      ),
  };
});

describe('makeAmqpEventBus', () => {
  it('frames events as transactionEvent envelopes on the fanout exchange', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.publish(anEvent()));

    expect(fake.published[0]?.body).toEqual({
      meta: { type: 'transactionEvent', entity: 'product' },
      data: anEvent(),
    });
  });

  it('asks for prefetch(1), without which the manager’s fold races', async () => {
    const { fake, bus } = withFakeChannel();

    await Effect.runPromise(bus.subscribe(() => Effect.void));

    // An accepted/completed pair delivered concurrently would otherwise upsert
    // twice for the same transaction.
    expect(fake.prefetchCount).toBe(1);
  });

  it('acks a message its handler accepted', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(() => Effect.void));

    await fake.deliver({
      meta: { type: 'transactionEvent', entity: 'product' },
      data: anEvent(),
    });

    expect(fake.acked).toHaveLength(1);
    expect(fake.nacked).toHaveLength(0);
  });

  it('dead-letters a message whose handler failed', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(
      bus.subscribe(() => Effect.fail(new Error('handler failed') as never)),
    );

    await fake.deliver({
      meta: { type: 'transactionEvent', entity: 'product' },
      data: anEvent(),
    });

    // `nack(message, false, false)` — no requeue, so a poison message cannot
    // spin forever.
    expect(fake.nacked).toHaveLength(1);
    expect(fake.acked).toHaveLength(0);
  });

  it('dead-letters a message that is not a transactionEvent envelope', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(() => Effect.void));

    await fake.deliver({ not: 'an envelope' });

    expect(fake.nacked).toHaveLength(1);
  });

  it('ignores a broker cancellation delivered as a null message', async () => {
    const { fake, bus } = withFakeChannel();
    await Effect.runPromise(bus.subscribe(() => Effect.void));

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

    const exit = await Effect.runPromiseExit(bus.subscribe(() => Effect.void));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
