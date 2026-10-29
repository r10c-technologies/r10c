import { EntityRepositoryFactoryTag } from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
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
import {
  CounterSaleRefused,
  readCounterSale,
  sellAtCounter,
  validateSalesChannel,
} from './counter-sale.js';

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
  const sell = (channelId: string, offeringId = 'mine') =>
    Effect.runPromise(
      sellAtCounter({
        organizationId: 'org-1',
        idempotencyKey: 'sale-1',
        sale: {
          channelId,
          paymentMethod: 'cash',
          lines: [{ offeringId, quantity: 2 }],
        },
      }).pipe(
        Effect.flip,
        Effect.orElseSucceed(() => 'succeeded' as const),
        Effect.provide(layer),
      ),
    );
  const sold = (channelId: string) =>
    Effect.runPromise(
      sellAtCounter({
        organizationId: 'org-1',
        idempotencyKey: 'sale-1',
        sale: {
          channelId,
          paymentMethod: 'cash',
          lines: [{ offeringId: 'mine', quantity: 2 }],
        },
      }).pipe(Effect.provide(layer)),
    );
  return { sell, sold, started };
};

describe('readCounterSale', () => {
  it('reads a channel, a payment method and lines of positive whole quantities', () => {
    expect(
      readCounterSale({
        channelId: 'c',
        paymentMethod: 'cash',
        lines: [{ offeringId: 'o', quantity: 1, amount: 1 }],
      }),
    ).toEqual({
      channelId: 'c',
      paymentMethod: 'cash',
      lines: [{ offeringId: 'o', quantity: 1 }],
    });
  });

  it('refuses anything else', () => {
    const line = { offeringId: 'o', quantity: 1 };
    const bodies: unknown[] = [
      null,
      'sale',
      { paymentMethod: 'cash', lines: [line] },
      { channelId: 'c', lines: [line] },
      { channelId: 'c', paymentMethod: 'cash', lines: [] },
      { channelId: 'c', paymentMethod: 'cash', lines: 'many' },
      { channelId: 'c', paymentMethod: 'cash', lines: [null] },
      {
        channelId: 'c',
        paymentMethod: 'cash',
        lines: [{ offeringId: 'o', quantity: 1.5 }],
      },
      { channelId: 'c', paymentMethod: 'cash', lines: [{ quantity: 1 }] },
    ];

    expect(bodies.map(readCounterSale).every(read => read === undefined)).toBe(
      true,
    );
  });
});

describe('validateSalesChannel', () => {
  it('passes a declared type and status, and names whichever is wrong', () => {
    expect(validateSalesChannel(channelOf('c', 'active'))).toBeUndefined();
    expect(
      validateSalesChannel(channelOf('c', 'active', 'kiosk')),
    ).toBeInstanceOf(EntifixBuildError);
    expect(validateSalesChannel(channelOf('c', 'paused'))).toBeInstanceOf(
      EntifixBuildError,
    );
  });
});

describe('sellAtCounter', () => {
  it('starts the checkout at published prices, with the channel copied onto the order', async () => {
    const { sold, started } = world();

    expect(await sold('c-open')).toEqual({ _tag: 'sold', result: 'r' });
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

    expect(
      refusals.map(refusal => (refusal as CounterSaleRefused).code),
    ).toEqual(['notFound', 'channelInactive', 'invalidBody', 'notYours']);
    expect(started).toEqual([]);
  });

  it('answers a compensated flow as unavailable, and a failed one as a store failure', async () => {
    expect(
      await world({ _tag: 'compensated', result: {} }).sold('c-open'),
    ).toEqual({
      _tag: 'unavailable',
    });
    expect(
      await world({ _tag: 'failed', status: 502, result: {} }).sell('c-open'),
    ).toBeInstanceOf(EntifixConnError);
  });
});
