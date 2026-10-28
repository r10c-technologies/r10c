import type { DomainEvent } from '@entifix/core';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { Agreement } from '../entities/agreement/index.js';
import {
  type FoldOutcome,
  type SaleHalf,
  SaleJoinTag,
} from '../ports/settlement-ports.js';
import {
  foldCancellation,
  foldCapture,
  foldPlacedOrder,
  foldRefund,
} from './fold-sale.js';

const eventOf = (name: string, data: unknown): DomainEvent => ({
  name,
  id: `${name}:1`,
  source: 'spec',
  at: '2026-10-25T12:00:00.000Z',
  correlationId: 'o-1',
  data,
});

const payment = {
  paymentId: 'pay-1',
  orderId: 'o-1',
  amount: 40,
  currency: 'GTQ',
  paymentMethod: 'card',
  decidedAt: '2026-10-25T12:00:00.000Z',
};

const order = {
  id: 'o-1',
  items: [
    { vendorId: 'v-1', amount: 10, quantity: 2, currency: 'GTQ' },
    { vendorId: 'v-2', amount: 5, quantity: 1, currency: 'GTQ' },
  ],
};

const joinThat = (outcome: FoldOutcome) => {
  const contributed: Array<{
    eventId: string;
    orderId: string;
    half: SaleHalf;
  }> = [];
  const layer = Layer.succeed(SaleJoinTag, {
    agreementsFor: () =>
      Effect.succeed(new Map([['v-1', new Agreement('v-1', 1000)]])),
    contribute: (claim, orderId, half) =>
      Effect.sync(() => {
        contributed.push({ eventId: claim.eventId, orderId, half });
        return outcome;
      }),
  });
  const run = <A, E>(effect: Effect.Effect<A, E, SaleJoinTag>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { run, contributed };
};

describe('the four folds', () => {
  it('prices a placed order through each vendor’s agreement, and names a vendor with none', async () => {
    const { run, contributed } = joinThat({
      kind: 'written',
      folded: 1,
      reversed: 0,
    });

    const report = await run(
      foldPlacedOrder(
        'settlement.order.placed',
        eventOf('order.placed', order),
      ),
    );

    expect(report).toMatchObject({
      event: 'order.placed',
      outcome: { kind: 'written', folded: 1 },
      unpriced: ['v-2'],
    });
    expect(contributed[0]?.half).toEqual({
      commissions: [
        {
          vendorId: 'v-1',
          saleAmount: 20,
          commissionAmount: 2,
          currency: 'GTQ',
        },
      ],
      unpriced: ['v-2'],
    });
  });

  it('prices a counter sale at its channel’s rate', async () => {
    const { run, contributed } = joinThat({ kind: 'waiting' });

    await run(
      foldPlacedOrder(
        'c',
        eventOf('order.placed', {
          ...order,
          items: [order.items[0]],
          channel: { type: 'counter' },
        }),
      ),
    );

    expect(contributed[0]?.half).toMatchObject({ unpriced: [] });
  });

  it('joins the capture on its decision time, the cancellation on its event time, the refund on its own', async () => {
    const { run, contributed } = joinThat({
      kind: 'written',
      folded: 0,
      reversed: 2,
    });

    await run(foldCapture('c', eventOf('payment.captured', payment)));
    await run(foldCancellation('c', eventOf('order.cancelled', order)));
    await run(
      foldRefund(
        'c',
        eventOf('payment.refunded', {
          ...payment,
          decidedAt: '2026-10-26T00:00:00.000Z',
        }),
      ),
    );

    expect(contributed.map(entry => entry.half)).toEqual([
      { decidedAt: '2026-10-25T12:00:00.000Z' },
      { cancelledAt: '2026-10-25T12:00:00.000Z' },
      { refundedAt: '2026-10-26T00:00:00.000Z' },
    ]);
  });

  it('answers a redelivery and a half still waiting without writing', async () => {
    const duplicate = joinThat({ kind: 'duplicate' });
    const waiting = joinThat({ kind: 'waiting' });

    expect(
      await duplicate.run(
        foldCapture('c', eventOf('payment.captured', payment)),
      ),
    ).toMatchObject({ outcome: { kind: 'duplicate' }, unpriced: [] });
    expect(
      await waiting.run(foldCapture('c', eventOf('payment.captured', payment))),
    ).toMatchObject({ outcome: { kind: 'waiting' }, unpriced: [] });
  });
});
