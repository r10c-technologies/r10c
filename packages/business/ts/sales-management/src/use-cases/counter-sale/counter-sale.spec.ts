import { EntityRepositoryFactoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  type PublishedPrice,
  PublishedPriceReaderTag,
} from '@r10c/business-ts-catalog-contracts';
import {
  type SagaInputs,
  SagaStarterTag,
  type SagaStartOutcome,
} from '@r10c/business-ts-saga-contracts';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { SalesChannel } from '../../entities/sales-channel/index.js';
import { sellAtCounter, validateSalesChannel } from './counter-sale.js';

const channelOf = (id: string, status: string, type = 'counter') =>
  Object.assign(new SalesChannel(), { id, name: `Till ${id}`, type, status });

const prices: Record<string, PublishedPrice> = {
  mine: { offeringId: 'mine', vendorId: 'org-1', amount: 500, currency: 'GTQ' },
  theirs: {
    offeringId: 'theirs',
    vendorId: 'org-2',
    amount: 9,
    currency: 'GTQ',
  },
};

const world = (
  outcome: SagaStartOutcome = { _tag: 'completed', result: 'r' },
) => {
  const started: SagaInputs[] = [];
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: () =>
        Effect.succeed(
          makeInMemoryEntityRepository([
            channelOf('c-open', 'active'),
            channelOf('c-shut', 'inactive'),
          ]),
        ),
    }),
    Layer.succeed(PublishedPriceReaderTag, {
      priceOf: offeringId => Effect.succeed(prices[offeringId]),
    }),
    Layer.succeed(SagaStarterTag, {
      start: (_definition, inputs) =>
        Effect.sync(() => {
          started.push(inputs);
          return outcome;
        }),
    }),
  );
  const sale = (channelId: string, offeringId = 'mine') =>
    sellAtCounter({
      organizationId: 'org-1',
      channelId,
      idempotencyKey: 'sale-1',
      sale: { paymentMethod: 'cash', lines: [{ offeringId, quantity: 2 }] },
    }).pipe(Effect.provide(layer));
  /** The failure a sale ends in. */
  const sell = (channelId: string, offeringId = 'mine') =>
    Effect.runPromise(Effect.flip(sale(channelId, offeringId)));
  const sold = (channelId: string) => Effect.runPromise(sale(channelId));
  return { sell, sold, started };
};

describe('validateSalesChannel', () => {
  it('passes a declared type and status, and names whichever is wrong', () => {
    const open = channelOf('c', 'active');
    const check = (channel: SalesChannel) =>
      Effect.runSync(
        validateSalesChannel(channel).pipe(
          Effect.as(undefined),
          Effect.catch(refusal => Effect.succeed(refusal.reason)),
        ),
      );

    expect(Effect.runSync(validateSalesChannel(open))).toBe(open);
    expect(check(channelOf('c', 'active', 'kiosk'))).toContain('"kiosk"');
    expect(check(channelOf('c', 'paused'))).toContain('"paused"');
  });
});

describe('sellAtCounter', () => {
  it('starts the checkout at published prices, with the channel copied onto the order', async () => {
    const { sold, started } = world();

    expect(await sold('c-open')).toBe('r');
    expect(started[0]?.['reserve']).toEqual([
      {
        organizationId: 'org-1',
        body: {
          meta: { type: 'entity', entity: 'reservation' },
          data: { offeringId: 'mine', quantity: 2 },
        },
      },
    ]);
    expect(JSON.stringify(started[0]?.['write-order'])).toContain(
      '"name":"Till c-open"',
    );
  });

  it('refuses an unknown channel, a retired one, an unpublished offering and somebody else’s', async () => {
    const { sell, started } = world();

    const refusals = await Promise.all([
      sell('c-none'),
      sell('c-shut'),
      sell('c-open', 'ghost'),
      sell('c-open', 'theirs'),
    ]);

    expect(refusals.map(refusal => refusal.code)).toEqual([
      'notFound',
      'channelInactive',
      'invalidBody',
      'notYours',
    ]);
    expect(started).toEqual([]);
  });

  it('answers a compensated flow as unavailable stock, and a failed one as the coordinator unavailable', async () => {
    expect(
      await world({ _tag: 'compensated', result: {} }).sell('c-open'),
    ).toMatchObject({ _tag: 'StockUnavailable', channelId: 'c-open' });
    expect(
      await world({ _tag: 'failed', status: 502, result: {} }).sell('c-open'),
    ).toMatchObject({
      _tag: 'UpstreamUnavailable',
      upstream: 'transaction-service',
    });
  });
});
