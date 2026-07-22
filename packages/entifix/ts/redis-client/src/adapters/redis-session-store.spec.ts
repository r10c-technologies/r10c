import { SessionStoreTag } from '@r10c/entifix-ts-business';
import { run, runFailure } from '@r10c/entifix-ts-testing-unit';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { RedisTag } from '../redis-connection/redis-connection.js';
import {
  DEFAULT_SESSION_NAMESPACE,
  makeRedisSessionStore,
  RedisSessionStoreLayer,
} from './redis-session-store.js';

/**
 * The store runs unchanged against a fake ioredis client, so the real key
 * layout (`{ns}:{sid}` record + `{ns}:user:{id}` index set), the TTL calls, and
 * the not-found branches are the code under test.
 */
const withFakeRedis = () => {
  const fake = makeFakeRedis();
  return { fake, redis: fake.redis as Redis };
};

const sampleData = {
  userId: 'user-1',
  subject: 'sub-1',
  roles: ['admin'],
  attributes: { plan: 'pro' },
};

describe('makeRedisSessionStore', () => {
  it('creates a session under the default namespace and reads it back', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const sessionId = await run(store.create(sampleData, 60));
    const record = await run(store.read(sessionId));

    expect(record.sessionId).toBe(sessionId);
    expect(record.userId).toBe('user-1');
    expect(record.roles).toEqual(['admin']);
    expect(record.attributes).toEqual({ plan: 'pro' });
    expect(record.createdAt).toEqual(expect.any(String));
    expect(record.expiresAt).toEqual(expect.any(String));
    // Persisted under the conventional record key, with an EX ttl.
    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${sessionId}`)).toBeDefined();
    expect(fake.commands).toContainEqual({
      command: 'set',
      args: [
        `${DEFAULT_SESSION_NAMESPACE}:${sessionId}`,
        expect.any(String),
        'EX',
        60,
      ],
    });
  });

  it('honours a custom namespace', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis, { namespace: 'sess' });

    const sessionId = await run(store.create(sampleData, 60));

    expect(fake.read(`sess:${sessionId}`)).toBeDefined();
  });

  it('mints unguessable, unique session ids', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const first = await run(store.create(sampleData, 60));
    const second = await run(store.create(sampleData, 60));

    expect(first).not.toEqual(second);
    expect(first.length).toBeGreaterThanOrEqual(43); // 32 bytes, base64url
  });

  it('fails reading an unknown session', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const error = await runFailure(store.read('nope'));

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('renews a live session on touch', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const sessionId = await run(store.create(sampleData, 60));

    await expect(run(store.touch(sessionId, 120))).resolves.toBeUndefined();
  });

  it('fails touching a vanished session', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const error = await runFailure(store.touch('gone', 120));

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('revokes a session and drops it from the user index', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const sessionId = await run(store.create(sampleData, 60));

    await run(store.revoke(sessionId));

    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${sessionId}`)).toBeUndefined();
    await expect(runFailure(store.read(sessionId))).resolves.toMatchObject({
      _tag: 'EntifixLogicError',
    });
    expect(fake.commands).toContainEqual({
      command: 'srem',
      args: [
        `${DEFAULT_SESSION_NAMESPACE}:user:user-1`,
        sessionId,
      ],
    });
  });

  it('revoking an already-absent session skips the index cleanup', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    await run(store.revoke('absent'));

    expect(fake.commands.some((c) => c.command === 'srem')).toBe(false);
  });

  it('revokes every session for a user', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const first = await run(store.create(sampleData, 60));
    const second = await run(store.create(sampleData, 60));

    await run(store.revokeAllForUser('user-1'));

    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${first}`)).toBeUndefined();
    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${second}`)).toBeUndefined();
  });

  it('revoking a user with no sessions is a no-op over an empty set', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    await expect(
      run(store.revokeAllForUser('ghost')),
    ).resolves.toBeUndefined();
  });

  it('surfaces a driver failure as an EntifixConnError', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    fake.failWith(new Error('connection reset'));

    const error = await runFailure(store.create(sampleData, 60));

    expect(error._tag).toBe('EntifixConnError');
  });

  it('provides SessionStoreTag through the layer', async () => {
    const { redis } = withFakeRedis();
    const layer = RedisSessionStoreLayer().pipe(
      Layer.provide(Layer.succeed(RedisTag, redis)),
    );

    const sessionId = await run(
      Effect.provide(
        Effect.flatMap(SessionStoreTag, (store) => store.create(sampleData, 60)),
        layer,
      ),
    );

    expect(sessionId).toEqual(expect.any(String));
  });
});
