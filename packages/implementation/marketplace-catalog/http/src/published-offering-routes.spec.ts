import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import { EntityRepositoryFactoryTag, TokenServiceTag } from '@entifix/business';
import { EntifixBuildError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedOfferingRoutes } from './published-offering-routes.js';

describe('publishedOfferingRoutes', () => {
  it('serves the projection to anybody, and offers no write', async () => {
    const served = serveRoutes(
      publishedOfferingRoutes,
      Layer.mergeAll(
        Layer.succeed(EntityRepositoryFactoryTag, {
          for: () => Effect.succeed(makeInMemoryEntityRepository()),
        }),
        Layer.succeed(TokenServiceTag, {
          sign: () => Effect.succeed('t'),
          verify: () => Effect.fail(new EntifixBuildError('no session')),
        }),
        Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision({})),
      ),
    );

    const read = await served.call('/api/published-offering');
    const write = await served.call('/api/published-offering', {
      method: 'POST',
    });
    await served.dispose();

    expect(read.status).toBe(200);
    expect(write.status).toBe(404);
  });
});
