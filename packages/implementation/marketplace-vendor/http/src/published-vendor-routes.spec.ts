import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  InvalidToken,
  TokenServiceTag,
} from '@entifix/business';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { publishedVendorRoutes } from './published-vendor-routes.js';

describe('publishedVendorRoutes', () => {
  it('serves the projection to anybody, and offers no write', async () => {
    const served = serveRoutes(
      publishedVendorRoutes,
      Layer.mergeAll(
        Layer.succeed(EntityRepositoryFactoryTag, {
          for: () => Effect.succeed(makeInMemoryEntityRepository()),
        }),
        Layer.succeed(TokenServiceTag, {
          sign: () => Effect.succeed('t'),
          verify: () => Effect.fail(new InvalidToken()),
        }),
        Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision({})),
      ),
    );

    const read = await served.call('/api/published-vendor');
    const write = await served.call('/api/published-vendor', {
      method: 'POST',
    });
    await served.dispose();

    expect(read.status).toBe(200);
    expect(write.status).toBe(404);
  });
});
