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
import {
  counterBuyerTax,
  sellAtCounter,
  validateSalesChannel,
} from './counter-sale.js';

const channelOf = (id: string, status: string, type = 'counter') =>
  Object.assign(new SalesChannel(), { id, name: `Till ${id}`, type, status });

const prices: Record<string, PublishedPrice> = {
  mine: {
    offeringId: 'mine',
    name: 'Taza de cerámica',
    description: 'Esmaltada a mano.',
    vendorId: 'org-1',
    amount: 500,
    currency: 'GTQ',
    specificationId: 'spec-mine',
    specificationVersion: 3,
  },
  plain: {
    offeringId: 'plain',
    name: 'Clavo',
    vendorId: 'org-1',
    amount: 5,
    currency: 'GTQ',
    specificationId: 'spec-plain',
    specificationVersion: 1,
  },
  theirs: {
    offeringId: 'theirs',
    name: 'Plato',
    vendorId: 'org-2',
    amount: 9,
    currency: 'GTQ',
    specificationId: 'spec-theirs',
    specificationVersion: 1,
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
  const sold = (channelId: string, offeringId = 'mine') =>
    Effect.runPromise(sale(channelId, offeringId));
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

describe('counterBuyerTax', () => {
  const refusal = (input: Parameters<typeof counterBuyerTax>[0]) =>
    Effect.runSync(
      counterBuyerTax(input).pipe(
        Effect.as(undefined),
        Effect.catch(failure => Effect.succeed(failure.code)),
      ),
    );

  it('documents a NIT the till gave, normalized, and a consumidor final by default', () => {
    expect(
      Effect.runSync(
        counterBuyerTax({ idType: 'nit', taxId: '1234567-9', name: ' Sol ' }),
      ),
    ).toEqual({ idType: 'nit', taxId: '12345679', name: 'Sol' });
    expect(Effect.runSync(counterBuyerTax(undefined))).toMatchObject({
      idType: 'cf',
      taxId: 'CF',
    });
  });

  it('refuses under the codes the storefront and the coordinator use', () => {
    expect(refusal({ idType: 'passport' })).toBe('invalidTaxIdType');
    expect(refusal({ idType: 'nit', taxId: '12345678', name: 'Sol' })).toBe(
      'invalidTaxId',
    );
    expect(refusal({ idType: 'cui', taxId: '12', name: 'Sol' })).toBe(
      'invalidTaxId',
    );
    expect(refusal({ idType: 'nit', taxId: '12345679' })).toBe('missingName');
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
          // Nothing given at the till: a consumidor final.
          buyerTax: { idType: 'cf', taxId: 'CF', name: '' },
          vendors: [
            {
              vendorId: 'org-1',
              paymentMethod: 'cash',
              lines: [
                {
                  offeringId: 'mine',
                  // Sold under the projection's name, description and
                  // version, like its price (#582, ADR 0079 §3).
                  name: 'Taza de cerámica',
                  description: 'Esmaltada a mano.',
                  specificationId: 'spec-mine',
                  specificationVersion: 3,
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

  it('copies no description onto a line whose specification had none', async () => {
    const { sold, started } = world();

    await sold('c-open', 'plain');

    const input = started[0]?.input as {
      readonly vendors: readonly {
        readonly lines: readonly Record<string, unknown>[];
      }[];
    };
    expect(input.vendors[0]?.lines[0]).not.toHaveProperty('description');
    expect(input.vendors[0]?.lines[0]).toMatchObject({
      specificationId: 'spec-plain',
      specificationVersion: 1,
    });
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
    ).toMatchObject({ code: 'flowNotStarted', refusal: 'notFound' });
    expect(await world('unreachable').sell('c-open')).toMatchObject({
      _tag: 'UpstreamUnavailable',
      upstream: 'transaction-service',
    });
  });
});
