import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityFacetCounterFactoryTag,
  EntityRepositoryFactoryTag,
  InvalidToken,
  TokenServiceTag,
} from '@entifix/business';
import {
  makeInMemoryEntityRepository,
  makeInMemoryFacetCounter,
} from '@entifix/testing-unit';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedOfferingRoutes } from './published-offering-routes.js';

const serve = (rows: PublishedOffering[] = []) =>
  serveRoutes(
    publishedOfferingRoutes,
    Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () => Effect.succeed(makeInMemoryEntityRepository(rows)),
      }),
      Layer.succeed(EntityFacetCounterFactoryTag, {
        for: () => Effect.succeed(makeInMemoryFacetCounter(rows)),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: () => Effect.fail(new InvalidToken()),
      }),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision({})),
    ),
  );

describe('publishedOfferingRoutes', () => {
  it('serves the projection to anybody, and offers no write', async () => {
    const served = serve();

    const read = await served.call('/api/published-offering');
    const write = await served.call('/api/published-offering', {
      method: 'POST',
    });
    await served.dispose();

    expect(read.status).toBe(200);
    expect(write.status).toBe(404);
  });

  it('counts a filterable member for anybody, and refuses one that is not', async () => {
    const offering = Object.assign(new PublishedOffering(), {
      id: 'o-1',
      brandId: 'brand-a',
    });
    const served = serve([offering]);

    const counted = await served.call(
      '/api/published-offering/$facets?facet=brandId',
    );
    const refused = await served.call(
      '/api/published-offering/$facets?facet=description',
    );
    const body = (await counted.json()) as { data: unknown };
    await served.dispose();

    expect(counted.status).toBe(200);
    expect(body.data).toEqual({ brandId: [{ value: 'brand-a', count: 1 }] });
    expect(refused.status).toBe(400);
  });
});
