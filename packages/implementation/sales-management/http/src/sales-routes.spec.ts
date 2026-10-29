import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  InvalidToken,
  TokenServiceTag,
} from '@entifix/business';
import { defineCatalog, flowCommit } from '@entifix/business/flow';
import { EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { PublishedPriceReaderTag } from '@r10c/business-ts-catalog-contracts';
import {
  SagaStarterTag,
  type SagaStartOutcome,
} from '@r10c/business-ts-saga-contracts';
import { SalesChannel } from '@r10c/business-ts-sales-management';
import { tokenClaims } from '@r10c/testing-cells';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer, Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { salesRoutes } from './sales-routes.js';

const channelOf = (id: string, status: string) =>
  Object.assign(new SalesChannel(), { id, name: id, type: 'counter', status });

const repository = makeInMemoryEntityRepository([
  channelOf('c-open', 'active'),
  channelOf('c-shut', 'inactive'),
]);

let outcome: Effect.Effect<SagaStartOutcome, EntifixConnError> = Effect.succeed(
  { _tag: 'completed', result: { orderId: 'o-1' } },
);

const vendor = tokenClaims();

/**
 * The smallest recipe `sell` can name: the cell only reports what its shell
 * resolves, and the real checkout is the flow catalog's to enumerate.
 */
const compositions = {
  catalog: defineCatalog([flowCommit]),
  recipes: {
    checkout: {
      name: 'checkout',
      input: Schema.Struct({}),
      requiresCommitPoint: true,
      stages: [{ name: 'commit', steps: [{ ref: 'flow.commit@1' }] }],
    },
  },
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    salesRoutes(compositions),
    Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(repository),
      }),
      Layer.succeed(PublishedPriceReaderTag, {
        priceOf: offeringId =>
          Effect.succeed(
            offeringId === 'mine'
              ? { offeringId, vendorId: 'org-1', amount: 5, currency: 'GTQ' }
              : offeringId === 'theirs'
                ? { offeringId, vendorId: 'org-2', amount: 5, currency: 'GTQ' }
                : undefined,
          ),
      }),
      Layer.succeed(SagaStarterTag, { start: () => outcome }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          token === 'vendor'
            ? Effect.succeed(vendor)
            : Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ admin: ['sales-management:*:*'] }),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const post = (path: string, body: unknown) =>
  served.call(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer vendor',
    },
    body: JSON.stringify(body),
  });

const sale = (channelId: string, offeringId = 'mine') => ({
  channelId,
  paymentMethod: 'cash',
  lines: [{ offeringId, quantity: 1 }],
});

describe('GET /api/sales-channel/$metadata', () => {
  it('reports the flow `sell` starts', async () => {
    const response = await served.call('/api/sales-channel/$metadata', {
      headers: { authorization: 'Bearer vendor' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        useCases: [
          {
            key: 'sell',
            composition: { recipe: 'checkout', fragments: ['flow.commit@1'] },
          },
        ],
      },
    });
  });
});

describe('POST /api/counter-sale', () => {
  it('sells, answering the saga’s result as 201', async () => {
    const response = await post('/api/counter-sale', sale('c-open'));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      data: { orderId: 'o-1' },
    });
  });

  it('answers each refusal with its own status and code', async () => {
    const responses = await Promise.all([
      post('/api/counter-sale', { channelId: 'c-open' }),
      post('/api/counter-sale', sale('c-none')),
      post('/api/counter-sale', sale('c-shut')),
      post('/api/counter-sale', sale('c-open', 'theirs')),
    ]);

    expect(responses.map(response => response.status)).toEqual([
      400, 404, 409, 403,
    ]);
    expect(
      await Promise.all(
        responses.map(
          async response => ((await response.json()) as { code: string }).code,
        ),
      ),
    ).toEqual(['invalidBody', 'notFound', 'channelInactive', 'notYours']);
  });

  it('answers a compensated flow with 409, and a failed coordinator with 500', async () => {
    outcome = Effect.succeed({ _tag: 'compensated', result: {} });
    const unavailable = await post('/api/counter-sale', sale('c-open'));
    outcome = Effect.fail(new EntifixConnError('coordinator down'));
    const failed = await post('/api/counter-sale', sale('c-open'));

    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toMatchObject({
      code: 'stockUnavailable',
    });
    expect(failed.status).toBe(500);
  });
});

describe('the sales channels', () => {
  const body = (data: Record<string, unknown>) => ({
    meta: { type: 'entity', entity: 'sales-channel' },
    data,
  });

  it('saves a declared channel, and refuses one of a type nobody priced', async () => {
    const saved = await post(
      '/api/sales-channel',
      body({ name: 'Kiosk', type: 'counter', status: 'active' }),
    );
    const refused = await post(
      '/api/sales-channel',
      body({ name: 'Kiosk', type: 'kiosk', status: 'active' }),
    );

    expect(saved.status).toBe(200);
    expect(refused.status).toBe(400);
  });
});
