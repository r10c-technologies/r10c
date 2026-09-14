import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { serveTestService } from '../serve-test-service.js';
import {
  DEV_SERVICE_TOKEN,
  requireServiceToken,
  SERVICE_TOKEN_HEADER,
  serviceToken,
} from './service-token.js';

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/config/auth-service',
    requireServiceToken(HttpServerResponse.json({ mongo: [] })),
  ),
);

const withService = async (
  use: (baseUrl: string) => Promise<void>,
): Promise<void> => {
  const service = await serveTestService({
    name: '@r10c/spec-config-service',
    port: 0,
    slices: ['test'],
    router,
    appLayer: Layer.empty,
  });
  try {
    await use(service.baseUrl);
  } finally {
    await service.close();
  }
};

afterEach(() => {
  delete process.env.CONFIG_SERVICE_TOKEN;
});

describe('serviceToken', () => {
  it('falls back to the documented dev token', () => {
    expect(serviceToken()).toBe(DEV_SERVICE_TOKEN);
  });

  it('reads the environment on each call, not at module load', () => {
    process.env.CONFIG_SERVICE_TOKEN = 'from-env';

    expect(serviceToken()).toBe('from-env');
  });
});

describe('requireServiceToken', () => {
  it('serves the route when the token matches', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: { [SERVICE_TOKEN_HEADER]: DEV_SERVICE_TOKEN },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mongo: [] });
    });
  });

  it('401s without the header', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'unauthenticated',
        code: 'unauthenticated',
      });
    });
  });

  it('401s on a wrong token of the same length', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: {
          [SERVICE_TOKEN_HEADER]: 'x'.repeat(DEV_SERVICE_TOKEN.length),
        },
      });

      expect(res.status).toBe(401);
    });
  });

  it('401s on a token of a different length', async () => {
    // The length guard exists because `timingSafeEqual` throws on a mismatch;
    // it must answer 401 rather than 500.
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/config/auth-service`, {
        headers: { [SERVICE_TOKEN_HEADER]: 'short' },
      });

      expect(res.status).toBe(401);
    });
  });

  it('leaves the health endpoints unguarded', async () => {
    // The probes come from the service base, not this router — asserting on them
    // is what pins the guard to the routes that carry credentials and no others.
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/health/ready`);

      expect(res.status).toBe(200);
    });
  });
});
