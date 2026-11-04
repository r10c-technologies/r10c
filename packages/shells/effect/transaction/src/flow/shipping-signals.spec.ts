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
  shippingSignalsSubscription,
  startShippingSignals,
} from './shipping-signals.js';

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
    startShippingSignals.pipe(
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
          source: 'fulfilment',
          at: '2026-11-04T00:00:00.000Z',
          data,
        } as DomainEvent),
      ),
    );
  return { signals, deliver, subscribed: () => subscribed };
};

const shipment = { id: 'ord-1', orderId: 'ord-1', status: 'delivered' };

describe('the shipping signals', () => {
  it('listen on every shipment event, as one work queue within the fleet budget', async () => {
    const { subscribed } = await consumer();

    expect(subscribed()).toEqual(shippingSignalsSubscription);
    expect(shippingSignalsSubscription).toMatchObject({
      slice: 'transaction',
      pattern: 'shipping-order.*',
      mode: 'work',
      maxAttempts: 5,
    });
  });

  it.each([
    ['shipping-order.delivered', 'delivered'],
    ['shipping-order.refused', 'refused'],
    ['shipping-order.returned', 'returned'],
  ])('answer the delivery flow’s wait on %s with %s', async (name, outcome) => {
    const { signals, deliver } = await consumer();

    expect(await deliver(name, shipment)).toMatchObject({ _tag: 'Success' });
    expect(signals).toEqual([
      { correlation: 'delivery:ord-1', signal: { outcome, shipment } },
    ]);
  });

  it.each([
    [
      'a dispatch, which the flow made itself',
      'shipping-order.dispatched',
      shipment,
    ],
    ['a report naming no shipment', 'shipping-order.delivered', { id: '' }],
    ['a report with no body', 'shipping-order.delivered', null],
  ])('let go of %s', async (_label, name, data) => {
    const { signals, deliver } = await consumer();

    expect(await deliver(name, data)).toMatchObject({ _tag: 'Success' });
    expect(signals).toEqual([]);
  });

  it('let go of a report the parked wait is not answered with, or already took', async () => {
    const { deliver } = await consumer(
      Effect.fail(new FlowSignalRejected({ flowId: 'f-1', token: 'wait' })),
    );

    expect(await deliver('shipping-order.delivered', shipment)).toMatchObject({
      _tag: 'Success',
    });
  });

  it('retry a report that arrived before its flow reached the wait', async () => {
    const { deliver } = await consumer(
      Effect.fail(new FlowNotFound({ flowId: 'delivery:ord-1' })),
    );

    expect(await deliver('shipping-order.refused', shipment)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'Unavailable', category: 'unavailable' },
    });
  });
});
