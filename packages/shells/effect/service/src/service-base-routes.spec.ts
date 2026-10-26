import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import { type TokenClaims, TokenServiceTag } from '@entifix/business';
import { EntifixBuildError } from '@entifix/core';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import { serveTestService } from '@entifix/service-shell/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { serviceBaseRoutes } from './service-base-routes.js';

const claims: TokenClaims = {
  userId: 'u-1',
  subject: 'u-1',
  sessionId: 's-1',
  roles: ['user'],
};

describe('serviceBaseRoutes', () => {
  it('serves the redacted configuration and the caller’s principal', async () => {
    const service = await serveTestService({
      name: 'spec-base-routes',
      port: 0,
      slices: ['spec'],
      router: serviceBaseRoutes({
        service: '@r10c/spec-service',
        store: 'mongo',
      }),
      appLayer: Layer.mergeAll(
        Layer.succeed(LoadedConfigurationTag, {
          mongo: [{ key: 'password', value: 'secret', isSecret: true }],
        }),
        Layer.succeed(TokenServiceTag, {
          sign: () => Effect.succeed('token'),
          verify: token =>
            token === 'good'
              ? Effect.succeed(claims)
              : Effect.fail(new EntifixBuildError('bad token')),
        }),
        Layer.succeed(
          PolicyDecisionTag,
          makeStaticPolicyDecision({ user: [] }),
        ),
      ),
    });
    try {
      const config = (await (
        await fetch(`${service.baseUrl}/api/config`)
      ).json()) as {
        service: string;
        store: string;
        configuration: unknown;
      };
      const me = await fetch(`${service.baseUrl}/api/me`, {
        headers: { Authorization: 'Bearer good' },
      });
      const anonymous = await fetch(`${service.baseUrl}/api/me`);

      expect(config.service).toBe('@r10c/spec-service');
      expect(config.store).toBe('mongo');
      expect(JSON.stringify(config.configuration)).not.toContain('secret');
      expect(((await me.json()) as { userId: string }).userId).toBe('u-1');
      expect(anonymous.status).toBe(401);
    } finally {
      await service.close();
    }
  });
});
