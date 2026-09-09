import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { serveTestService } from '../serve-test-service.js';
import { ACCESS_COOKIE } from './require-principal.js';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
  requireServiceCrossing,
  ServiceCrossingTokenTag,
} from './require-service-crossing.js';

const EXPECTED = 'spec-crossing-token';

const router = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/api/reservation',
    requireServiceCrossing('stock-management:reservation:write')(
      organizationId => HttpServerResponse.json({ organizationId }),
    ),
  ),
  // A permission no crossing grants, guarded by the same mechanism — the token
  // is correct and the answer is still 403.
  HttpRouter.post(
    '/api/stock-item',
    requireServiceCrossing('stock-management:stock-item:write')(
      organizationId => HttpServerResponse.json({ organizationId }),
    ),
  ),
);

const withService = async (
  use: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const service = await serveTestService({
    name: '@r10c/spec-crossing-service',
    port: 0,
    slices: ['test'],
    router,
    appLayer: Layer.succeed(ServiceCrossingTokenTag, EXPECTED),
  });
  try {
    await use(service.baseUrl);
  } finally {
    await service.close();
  }
};

const post = (
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<Response> => fetch(`${baseUrl}${path}`, { method: 'POST', headers });

describe('requireServiceCrossing', () => {
  it('hands the named organization to the handler', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: EXPECTED,
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        organizationId: 'demo-organization',
      });
    });
  });

  it('trims the organization header', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: EXPECTED,
        [ORGANIZATION_HEADER]: '  demo-organization  ',
      });

      expect(await res.json()).toEqual({
        organizationId: 'demo-organization',
      });
    });
  });

  it('401s without the token', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'unauthenticated',
        code: 'unauthenticated',
      });
    });
  });

  it('401s on a wrong token of the same length', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: 'x'.repeat(EXPECTED.length),
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(401);
    });
  });

  it('401s on a token of a different length', async () => {
    // The length guard exists because `timingSafeEqual` throws on a mismatch;
    // it has to answer 401 rather than 500.
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: 'short',
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(401);
    });
  });

  it('401s on a session, however privileged — it reads no cookie', async () => {
    // ⚠️ The rule this guard exists to hold. `super-admin` holds `*:*:*`, which
    // matches every crossing permission, so a route that also accepted a session
    // would be reachable from an operator's browser. There is no token here to
    // verify and none is looked for: the cookie is simply not a credential on
    // this route.
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        cookie: `${ACCESS_COOKIE}=any-token-at-all`,
        authorization: 'Bearer any-token-at-all',
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(401);
    });
  });

  it('403s on a permission no crossing grants, token or not', async () => {
    // Fleet membership is not a capability: the token proves the caller is the
    // fleet, `SERVICE_CROSSING_PERMISSIONS` says what the fleet may do.
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/stock-item', {
        [CROSSING_TOKEN_HEADER]: EXPECTED,
        [ORGANIZATION_HEADER]: 'demo-organization',
      });

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'forbidden',
        code: 'forbidden',
        permission: 'stock-management:stock-item:write',
      });
    });
  });

  it('400s when the crossing names no organization', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: EXPECTED,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'invalidRequest' });
    });
  });

  it('400s on a blank organization header', async () => {
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {
        [CROSSING_TOKEN_HEADER]: EXPECTED,
        [ORGANIZATION_HEADER]: '   ',
      });

      expect(res.status).toBe(400);
    });
  });

  it('checks the token before the organization', async () => {
    // Order matters: nothing about what this route wants is revealed to a
    // caller that has not first proved it is the fleet.
    await withService(async baseUrl => {
      const res = await post(baseUrl, '/api/reservation', {});

      expect(res.status).toBe(401);
    });
  });
});
