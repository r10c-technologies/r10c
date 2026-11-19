import type { DomainEvent } from '@entifix/core';
import {
  EventBusTag,
  type FlowEngine,
  FlowEngineTag,
  FlowNotFound,
  FlowSignalRejected,
  type Subscription,
} from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  paymentSignalsSubscription,
  startPaymentSignals,
} from './payment-signals.js';

type Handler = (event: DomainEvent) => Effect.Effect<void, unknown>;

/**
 * The consumer, subscribed to a bus that keeps its handler, over an engine
 * that answers every correlated signal with `answer` and remembers it.
 */
const consumer = async (answer: Effect.Effect<void, unknown> = Effect.void) => {
  const signals: Array<{ correlation: string; signal: unknown }> = [];
  let subscribed: Subscription | undefined;
  let handler: Handler | undefined;
  const engine: Partial<FlowEngine> = {
    signalCorrelated: (correlation, signal) => {
      signals.push({ correlation, signal });
      return answer as never;
    },
  };
  await Effect.runPromise(
    startPaymentSignals.pipe(
      Effect.provideService(EventBusTag, {
        publish: () => Effect.void,
        subscribe: (subscription: Subscription, handle: Handler) =>
          Effect.sync(() => {
            subscribed = subscription;
            handler = handle;
          }),
      } as never),
      Effect.provideService(FlowEngineTag, engine as FlowEngine),
    ),
  );
  const deliver = (name: string, data: unknown) =>
    Effect.runPromise(
      Effect.result(
        (handler as Handler)({
          name,
          id: `${name}-1`,
          source: 'order',
          at: '2026-11-19T00:00:00.000Z',
          data,
        } as DomainEvent),
      ),
    );
  return { signals, deliver, subscribed: () => subscribed };
};

const order = {
  id: 'ord-1',
  groupId: 'grp-1',
  vendorId: 'v-1',
  paymentMethod: 'link',
};

describe('the payment signals', () => {
  it('listen on every order event, as one work queue within the fleet budget', async () => {
    const { subscribed } = await consumer();

    expect(subscribed()).toEqual(paymentSignalsSubscription);
    expect(paymentSignalsSubscription).toMatchObject({
      slice: 'transaction',
      pattern: 'order.*',
      mode: 'work',
      maxAttempts: 5,
    });
  });

  it.each([
    ['order.payment-confirmed', 'confirmed'],
    ['order.cancelled', 'cancelled'],
  ])('answer a link order’s wait on %s with %s', async (name, outcome) => {
    const { signals, deliver } = await consumer();

    expect(await deliver(name, order)).toMatchObject({ _tag: 'Success' });
    expect(signals).toEqual([
      { correlation: 'payment:grp-1:v-1', signal: { outcome } },
    ]);
  });

  it('hand a confirmation’s authorization number to the wait', async () => {
    const { signals, deliver } = await consumer();

    await deliver('order.payment-confirmed', {
      ...order,
      paymentReference: 'AUTH-123456',
    });

    expect(signals).toEqual([
      {
        correlation: 'payment:grp-1:v-1',
        signal: { outcome: 'confirmed', paymentReference: 'AUTH-123456' },
      },
    ]);
  });

  it.each([
    ['a placement, which no wait listens for', 'order.placed', order],
    [
      'a card order’s cancellation, which never waited',
      'order.cancelled',
      { ...order, paymentMethod: 'card' },
    ],
    ['an order naming no group', 'order.cancelled', { ...order, groupId: '' }],
    ['an order naming no vendor', 'order.cancelled', { ...order, vendorId: 1 }],
    [
      'an order naming no tender',
      'order.cancelled',
      { ...order, paymentMethod: undefined },
    ],
    ['an event with no body', 'order.cancelled', undefined],
  ])('let go of %s', async (_label, name, data) => {
    const { signals, deliver } = await consumer();

    expect(await deliver(name, data)).toMatchObject({ _tag: 'Success' });
    expect(signals).toEqual([]);
  });

  it('let go of an answer the wait already took', async () => {
    const { deliver } = await consumer(
      Effect.fail(new FlowSignalRejected({ flowId: 'f-1', token: 'wait' })),
    );

    expect(await deliver('order.cancelled', order)).toMatchObject({
      _tag: 'Success',
    });
  });

  it('retry an answer that arrived before its flow reached the wait', async () => {
    const { deliver } = await consumer(
      Effect.fail(new FlowNotFound({ flowId: 'payment:grp-1:v-1' })),
    );

    expect(await deliver('order.payment-confirmed', order)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'Unavailable', category: 'unavailable' },
    });
  });
});
