import { HttpRouter, HttpServerResponse } from '@effect/platform';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { type TokenClaims, TokenServiceTag } from '@r10c/entifix-ts-business';
import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';

import { serveTestService } from '../serve-test-service.js';
import { requirePermission, requirePrincipal } from './require-principal.js';

/**
 * A stand-in token service: the token IS its JSON claims, and anything that
 * does not parse is rejected. Keeps the guard under test rather than jose.
 */
const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new EntifixBuildError('invalid token'),
    }),
});

const tokenFor = (roles: readonly string[]): string =>
  JSON.stringify({
    userId: 'user-1',
    subject: 'user-1',
    sessionId: 'session-1',
    roles,
  } satisfies TokenClaims);

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/me',
    requirePrincipal(principal => HttpServerResponse.json(principal)),
  ),
  HttpRouter.get(
    '/api/users',
    requirePermission('authn:user-identity:read')(principal =>
      HttpServerResponse.json({ roles: principal.roles }),
    ),
  ),
);

const definition = {
  name: '@r10c/spec-auth-service',
  port: 0,
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

describe('requirePrincipal', () => {
  it('rebuilds the principal from a bearer token', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${tokenFor(['admin'])}` },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        userId: 'user-1',
        subject: 'user-1',
        sessionId: 'session-1',
        roles: ['admin'],
        // Volatile attributes never ride in the token.
        attributes: {},
      });
    });
  });

  it('accepts the token from the forwarded cookie too', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: `r10c_at=${tokenFor(['user'])}` },
      });

      expect(res.status).toBe(200);
    });
  });

  it('401s without a token', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/me`);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthenticated' });
    });
  });

  it('401s on a token the service cannot verify', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: 'Bearer not-a-token' },
      });

      expect(res.status).toBe(401);
    });
  });

  it('ignores a non-bearer authorization scheme', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Authorization: `Basic ${tokenFor(['admin'])}` },
      });

      expect(res.status).toBe(401);
    });
  });
});

describe('requirePermission', () => {
  it('runs the handler when the policy allows the action', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${tokenFor(['admin'])}` },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ roles: ['admin'] });
    });
  });

  // The distinction is the whole point: a 401 tells the client to sign in, a
  // 403 tells it that signing in again will not help.
  it('403s an authenticated caller the policy denies', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { Authorization: `Bearer ${tokenFor(['user'])}` },
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'forbidden',
        permission: 'authn:user-identity:read',
      });
    });
  });

  it('401s an unauthenticated caller before consulting the policy', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/users`);

      expect(res.status).toBe(401);
    });
  });
});
