import { EntityRepositoryFactoryTag } from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  type PublishedPrice,
  PublishedPriceReaderTag,
} from '@r10c/business-ts-catalog-contracts';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  type FlowCoordinatorScript,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
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
  answer:
    | NonNullable<ReturnType<FlowCoordinatorScript>>
    | 'unreachable' = acceptedAnswer('flow-1'),
) => {
  const started: { recipe: string; input: unknown; key: string }[] = [];
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
    Layer.succeed(
      FlowStarterTag,
      makeScriptedFlowStarter((recipe, input, key) => {
        started.push({ recipe, input, key });
        return answer === 'unreachable' ? undefined : answer;
      }),
    ),
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
  it('starts the checkout at published prices, with the channel on it, and answers the flow', async () => {
    const { sold, started } = world();

    expect(await sold('c-open')).toMatchObject({ flowId: 'flow-1' });
    expect(started).toEqual([
      {
        recipe: 'checkout',
        key: 'sale-1',
        input: {
          channel: { type: 'counter', id: 'c-open', name: 'Till c-open' },
          vendors: [
            {
              vendorId: 'org-1',
              paymentMethod: 'cash',
              lines: [
                {
                  offeringId: 'mine',
                  quantity: 2,
                  amount: 500,
                  currency: 'GTQ',
                },
              ],
            },
          ],
          totals: [{ currency: 'GTQ', amount: 1000 }],
        },
      },
    ]);
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

  it('answers the coordinator’s refusal, and a coordinator it cannot reach, as they are', async () => {
    expect(
      await world({
        status: 403,
        contentType: 'application/problem+json',
        body: {
          type: 'about:blank',
          title: 'notFound',
          status: 404,
          code: 'notFound',
          category: 'notFound',
        },
      }).sell('c-open'),
    ).toMatchObject({ code: 'notFound' });
    expect(await world('unreachable').sell('c-open')).toMatchObject({
      _tag: 'UpstreamUnavailable',
      upstream: 'transaction-service',
    });
  });
});
