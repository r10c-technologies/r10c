import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { type TokenClaims, TokenServiceTag } from '@r10c/entifix-ts-business';
import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';

import { serveTestService } from '../serve-test-service.js';
import { requireOrganization } from './require-organization.js';

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new EntifixBuildError('invalid token'),
    }),
});

const tokenFor = (activeOrganizationId?: string): string =>
  JSON.stringify({
    userId: 'user-1',
    subject: 'user-1',
    sessionId: 'session-1',
    roles: ['admin'],
    ...(activeOrganizationId === undefined ? {} : { activeOrganizationId }),
  } satisfies TokenClaims);

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/catalog',
    requireOrganization('product-configuration-management:product:read')(
      organizationId => HttpServerResponse.json({ organizationId }),
    ),
  ),
);

const definition = {
  name: '@r10c/spec-tenancy-service',
  port: 0,
  slices: ['test'],
  router,
  appLayer: Layer.mergeAll(
    Layer.succeed(TokenServiceTag, fakeTokens),
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
  ),
};

const withService = async (
  use: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const service = await serveTestService(definition);
  try {
    await use(service.baseUrl);
  } finally {
    await service.close();
  }
};

describe('requireOrganization', () => {
  it('hands the handler the organization from the verified token', async () => {
    await withService(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/catalog`, {
        headers: { authorization: `Bearer ${tokenFor('org-1')}` },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ organizationId: 'org-1' });
    });
  });

  it('answers 409 when the session names no organization', async () => {
    // Not a 403: the caller is authenticated and permitted, there is simply no
    // storage to read. An operator lands here by design — reaching a tenant is
    // an audited act-as-organization crossing, never a wider default.
    await withService(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/catalog`, {
        headers: { authorization: `Bearer ${tokenFor()}` },
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: 'noActiveOrganization',
      });
    });
  });

  it('still answers 401 before it ever looks for an organization', async () => {
    await withService(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/catalog`);

      expect(response.status).toBe(401);
    });
  });

  it('ignores an organization the caller supplies in the query string', async () => {
    // The single property the whole isolation model rests on: the organization
    // comes from the verified token, never from anything the caller controls.
    await withService(async baseUrl => {
      const response = await fetch(
        `${baseUrl}/api/catalog?organizationId=org-victim`,
        { headers: { authorization: `Bearer ${tokenFor('org-1')}` } },
      );

      expect(await response.json()).toEqual({ organizationId: 'org-1' });
    });
  });
});
