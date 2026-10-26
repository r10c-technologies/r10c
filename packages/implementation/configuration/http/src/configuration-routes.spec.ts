import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  Configuration,
  ConfigurationWriteRefused,
  ConfigurationWriterTag,
} from '@r10c/business-ts-configuration';
import { type ServedRoutes,serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configurationRoutes } from './configuration-routes.js';

const row = (id: string, key: string) =>
  Object.assign(new Configuration(), {
    id,
    service: 'svc',
    groupName: 'g',
    key,
  });

const writes: string[] = [];

const writer = Layer.succeed(ConfigurationWriterTag, {
  save: (incoming, actor) =>
    incoming.key === 'refused'
      ? Effect.fail(new ConfigurationWriteRefused('secretRequiresValue'))
      : incoming.key === 'broken'
        ? Effect.fail(new EntifixConnError('store down'))
        : Effect.sync(() => {
            writes.push(`save ${String(incoming.id)} by ${actor.subject}`);
            return Object.assign(incoming, { id: incoming.id ?? 'cfg-new' });
          }),
  delete: (id, actor) =>
    id === 'broken'
      ? Effect.fail(new EntifixConnError('store down'))
      : Effect.sync(() => {
          writes.push(`delete ${String(id)} by ${actor.subject}`);
          return id !== 'missing';
        }),
});

const claims: TokenClaims = {
  userId: 'user-1',
  subject: 'ada@example.com',
  sessionId: 's-1',
  roles: ['operator'],
};

let served: ServedRoutes;

beforeAll(async () => {
  served = serveRoutes(
    configurationRoutes,
    Layer.mergeAll(
      writer,
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: () =>
          Effect.succeed(
            makeInMemoryEntityRepository([
              row('cfg-1', 'uri'),
              row('cfg-2', 'db'),
            ]),
          ),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('token'),
        verify: token =>
          token === 'operator'
            ? Effect.succeed(claims)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ operator: ['config:configuration:*'] }),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const call = (path: string, init: RequestInit = {}) =>
  served.call(path, {
    ...init,
    headers: {
      authorization: 'Bearer operator',
      'content-type': 'application/json',
    },
  });

const envelope = (data: Record<string, unknown>) =>
  JSON.stringify({ meta: { type: 'entity', entity: 'configuration' }, data });

describe('configurationRoutes', () => {
  it('serves the generic reads, behind the permission', async () => {
    const list = await call('/api/configuration');
    const one = await call('/api/configuration/cfg-1');
    const anonymous = await served.call('/api/configuration');

    expect(list.status).toBe(200);
    expect(one.status).toBe(200);
    expect(anonymous.status).toBe(401);
  });

  it('creates and updates through the audited writer, the URL naming the row', async () => {
    const created = await call('/api/configuration', {
      method: 'POST',
      body: envelope({ key: 'new' }),
    });
    const updated = await call('/api/configuration/cfg-2', {
      method: 'PUT',
      body: envelope({ id: 'elsewhere', key: 'db' }),
    });

    expect(created.status).toBe(200);
    expect(updated.status).toBe(200);
    expect(writes).toContain('save undefined by ada@example.com');
    expect(writes).toContain('save cfg-2 by ada@example.com');
  });

  it('answers the write-only refusal, a body that is not an envelope, and a failed store', async () => {
    const refused = await call('/api/configuration', {
      method: 'POST',
      body: envelope({ key: 'refused' }),
    });
    const invalid = await call('/api/configuration', {
      method: 'POST',
      body: JSON.stringify({ nope: true }),
    });
    const broken = await call('/api/configuration', {
      method: 'POST',
      body: envelope({ key: 'broken' }),
    });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'secretRequiresValue' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'invalidBody' });
    expect(broken.status).toBe(500);
  });

  it('deletes through the writer, 404s a missing row, and 500s a failed store', async () => {
    const deleted = await call('/api/configuration/cfg-1', {
      method: 'DELETE',
    });
    const missing = await call('/api/configuration/missing', {
      method: 'DELETE',
    });
    const broken = await call('/api/configuration/broken', {
      method: 'DELETE',
    });

    expect(await deleted.json()).toMatchObject({ data: { id: 'cfg-1' } });
    expect(missing.status).toBe(404);
    expect(broken.status).toBe(500);
  });
});
