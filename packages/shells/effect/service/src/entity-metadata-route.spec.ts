import { HttpRouter } from '@effect/platform';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import { type TokenClaims, TokenServiceTag } from '@r10c/entifix-ts-business';
import {
  accessor,
  EntifixBuildError,
  type Entity,
  entity,
  type EntityId,
  useCase,
} from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';

import { entityMetadataRoute } from './entity-metadata-route.js';
import { serveTestService } from './serve-test-service.js';

/**
 * Declared locally rather than imported: this package is `scope:shared`, so it
 * may not reach `business-ts-authn`. The `domain`/`key` pair is what matters —
 * it is what the real `ROLE_PERMISSIONS` grants against, so the spec exercises
 * the shipped grant table rather than a stub of it.
 */
@entity({ domain: 'authn', key: 'user-identity' })
class UserIdentity implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: UserIdentity,
  key: 'update-aspects',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:user-identity.useCases.updateAspects',
})
class UpdateUserAspectsUC {
  static run() {
    return undefined;
  }
}

@useCase({
  entity: UserIdentity,
  key: 'revoke-sessions',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:user-identity.useCases.revokeSessions',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
  },
})
class RevokeUserSessionsUC {
  static run() {
    return undefined;
  }
}

/** An entity nobody is granted anything on — the "not readable" case. */
@entity({ domain: 'authn', key: 'secret-ledger' })
class SecretLedger implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const fakeTokens = TokenServiceTag.of({
  sign: claims => Effect.succeed(JSON.stringify(claims)),
  verify: token =>
    Effect.try({
      try: () => JSON.parse(token) as TokenClaims,
      catch: () => new EntifixBuildError('invalid token'),
    }),
});

const bearerFor = (roles: readonly string[]) => ({
  Authorization: `Bearer ${JSON.stringify({
    userId: 'user-1',
    subject: 'user-1',
    sessionId: 'session-1',
    roles,
  } satisfies TokenClaims)}`,
});

const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/user-identity/$metadata',
    entityMetadataRoute(UserIdentity),
  ),
  // The regression test for the wildcard trap: a by-id route registered FIRST,
  // so the literal has to win on specificity rather than on ordering.
  HttpRouter.get('/api/secret-ledger/:id', entityMetadataRoute(SecretLedger)),
  HttpRouter.get(
    '/api/secret-ledger/$metadata',
    entityMetadataRoute(SecretLedger),
  ),
);

const definition = {
  name: '@r10c/spec-metadata-service',
  port: 0,
  router,
  appLayer: Layer.mergeAll(
    Layer.succeed(TokenServiceTag, fakeTokens),
    Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
  ),
};

/** The envelope shape these assertions read, so `res.json()` is not `unknown`. */
interface MetadataBody {
  meta: { type: string; entity: string };
  data: {
    actions: string[];
    useCases: Array<{
      key: string;
      confirm?: { tone: string; messageKey: string };
    }>;
  };
}

const readBody = async (res: Response): Promise<MetadataBody> =>
  (await res.json()) as MetadataBody;

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

describe('entityMetadataRoute', () => {
  it('refuses an anonymous request', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        error: 'unauthenticated',
        code: 'unauthenticated',
      });
    });
  });

  it('answers 404 — not 403 — to a caller who may not read the entity', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['user']),
      });

      // Indistinguishable from an entity this service does not host, so the
      // endpoint cannot be walked to enumerate the model.
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        message: 'not found',
        code: 'notFound',
        entity: 'user-identity',
      });
    });
  });

  it('serves the actions and verbs an admin holds, and no more', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });

      expect(res.status).toBe(200);
      const body = await readBody(res);
      expect(body.meta).toEqual({
        type: 'entityMetadata',
        entity: 'user-identity',
      });
      // `admin` holds read + write on this entity but not delete.
      expect(body.data.actions).toEqual(['read', 'write']);
      expect(body.data.useCases.map(d => d.key)).toEqual([
        'update-aspects',
        'revoke-sessions',
      ]);
      expect(body.data.useCases[1].confirm).toEqual({
        tone: 'destructive',
        messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
      });
      expect(UpdateUserAspectsUC.run()).toBeUndefined();
      expect(RevokeUserSessionsUC.run()).toBeUndefined();
    });
  });

  it('serves the whole triple to a wildcard grant', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['super-admin']),
      });

      expect(res.status).toBe(200);
      const body = await readBody(res);
      expect(body.data.actions).toEqual(['read', 'write', 'delete']);
      expect(body.data.useCases).toHaveLength(2);
    });
  });

  it('marks the response private and varies on both credential carriers', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });

      expect(res.headers.get('cache-control')).toBe('private, no-cache');
      expect(res.headers.get('vary')).toBe('Cookie, Authorization');
      expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    });
  });

  it('answers 304 to a matching If-None-Match', async () => {
    await withService(async baseUrl => {
      const first = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });
      const etag = first.headers.get('etag') ?? '';

      const second = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: { ...bearerFor(['admin']), 'If-None-Match': etag },
      });

      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
    });
  });

  it('gives two principals different documents, and different ETags', async () => {
    await withService(async baseUrl => {
      const asAdmin = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: bearerFor(['admin']),
      });
      const asSuperAdmin = await fetch(
        `${baseUrl}/api/user-identity/$metadata`,
        { headers: bearerFor(['super-admin']) },
      );

      expect(asAdmin.headers.get('etag')).not.toBe(
        asSuperAdmin.headers.get('etag'),
      );

      // The half that matters: an admin's ETag must not revalidate a
      // super-admin's document, or one caller is served the other's affordances.
      const crossed = await fetch(`${baseUrl}/api/user-identity/$metadata`, {
        headers: {
          ...bearerFor(['super-admin']),
          'If-None-Match': asAdmin.headers.get('etag') ?? '',
        },
      });
      expect(crossed.status).toBe(200);
    });
  });

  it('is reached at its literal path even where a /:id route is registered first', async () => {
    await withService(async baseUrl => {
      const res = await fetch(`${baseUrl}/api/secret-ledger/$metadata`, {
        headers: bearerFor(['super-admin']),
      });

      expect(res.status).toBe(200);
      expect((await readBody(res)).meta.entity).toBe('secret-ledger');
    });
  });
});
