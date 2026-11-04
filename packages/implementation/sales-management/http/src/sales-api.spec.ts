import {
  type EntityApiContext,
  EntityRepositoryFactoryTag,
  IdempotencyKeyTag,
} from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import { FlowStarterTag } from '@r10c/business-ts-flow-contracts';
import {
  acceptedAnswer,
  makeScriptedFlowStarter,
} from '@r10c/business-ts-flow-contracts/testing';
import {
  SalesChannel,
  validateSalesChannel,
} from '@r10c/business-ts-sales-management';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { salesChannelApi } from './sales-api.js';

const context: EntityApiContext = {
  organizationId: 'org-1',
  links: { record: () => [], collection: () => [] },
};

const counter = Object.assign(new SalesChannel('Mostrador', 'counter'), {
  id: 'c-1',
  status: 'active',
});

const [sell] = salesChannelApi.options.useCases;

describe('the sales-channel declaration', () => {
  it('scopes every endpoint to the caller’s organization and checks a channel as it is saved', () => {
    expect(salesChannelApi.options.guard).toEqual({ kind: 'organization' });
    expect(salesChannelApi.options.prepare).toBe(validateSalesChannel);
  });

  it('serves the till’s sale as the channel’s own verb, keyed for the checkout', () => {
    expect(sell.useCase.key).toBe('sell');
    expect(sell.idempotent).toBe('unit');
    expect(sell.accepted).toBe(true);
  });

  it('starts the checkout under the till’s key and answers the flow to follow', async () => {
    const keys: string[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(makeInMemoryEntityRepository([counter])),
      }),
      Layer.succeed(PublishedPriceReaderTag, {
        priceOf: offeringId =>
          Effect.succeed({
            offeringId,
            vendorId: 'org-1',
            amount: 25,
            currency: 'GTQ',
          }),
      }),
      Layer.succeed(
        FlowStarterTag,
        makeScriptedFlowStarter((_recipe, _input, key) => {
          keys.push(key);
          return acceptedAnswer('flow-1');
        }),
      ),
      Layer.succeed(IdempotencyKeyTag, 'sale-key-1'),
    );

    const answer = await Effect.runPromise(
      sell
        .handler(
          {
            params: { id: 'c-1' },
            payload: {
              paymentMethod: 'cash',
              lines: [{ offeringId: 'o-1', quantity: 2 }],
            },
          },
          context,
        )
        .pipe(Effect.provide(layer)),
    );

    expect(keys).toEqual(['sale-key-1']);
    expect(answer).toMatchObject({
      meta: { type: 'flowAccepted', entity: 'counter-sale' },
      data: { flowId: 'flow-1' },
    });
  });
});
