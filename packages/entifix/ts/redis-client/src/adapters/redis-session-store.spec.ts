import { SessionStoreTag } from '@r10c/entifix-ts-business';
import { run, runFailure } from '@r10c/entifix-ts-testing-unit';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/** A one-minute sliding window under a one-hour ceiling. */
const lifetime = { idleTtlSeconds: 60, absoluteTtlSeconds: 3600 };

/**
 * Only `Date` is faked. Faking `setTimeout` too would stall Effect's own
 * scheduler and hang `run`, so the clock moves while the runtime keeps ticking.
 */
const atTime = (millis: number): void => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(millis);
};

describe('makeRedisSessionStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a session under the default namespace and reads it back', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const sessionId = await run(store.create(sampleData, lifetime));
    const record = await run(store.read(sessionId));

    expect(record.sessionId).toBe(sessionId);
    expect(record.userId).toBe('user-1');
    expect(record.roles).toEqual(['admin']);
    expect(record.attributes).toEqual({ plan: 'pro' });
    expect(record.createdAt).toEqual(expect.any(String));
    expect(record.expiresAt).toEqual(expect.any(String));
    // Persisted under the conventional record key, with an EX ttl.
    expect(
      fake.read(`${DEFAULT_SESSION_NAMESPACE}:${sessionId}`),
    ).toBeDefined();
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

    const sessionId = await run(store.create(sampleData, lifetime));

    expect(fake.read(`sess:${sessionId}`)).toBeDefined();
  });

  it('mints unguessable, unique session ids', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const first = await run(store.create(sampleData, lifetime));
    const second = await run(store.create(sampleData, lifetime));

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
    const sessionId = await run(store.create(sampleData, lifetime));

    await expect(run(store.touch(sessionId, 120))).resolves.toBeUndefined();
  });

  it('fails touching a vanished session', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const error = await runFailure(store.touch('gone', 120));

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('stamps the ceiling and keeps the user index alive for it', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const sessionId = await run(store.create(sampleData, lifetime));
    const record = await run(store.read(sessionId));

    // The window ends within the hour; the ceiling is the hour itself.
    expect(Date.parse(record.absoluteExpiresAt)).toBeGreaterThan(
      Date.parse(record.expiresAt),
    );
    // The index has to outlive any single session or a later one becomes
    // unrevokable through it.
    expect(fake.commands).toContainEqual({
      command: 'expire',
      args: [`${DEFAULT_SESSION_NAMESPACE}:user:user-1`, 3600],
    });
  });

  it('caps the first window when the ceiling is nearer than the idle ttl', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    const sessionId = await run(
      store.create(sampleData, {
        idleTtlSeconds: 3600,
        absoluteTtlSeconds: 60,
      }),
    );

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

  it('clamps a renewal to whatever is left under the ceiling', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    atTime(1_000_000);
    const sessionId = await run(store.create(sampleData, lifetime));

    // 3580s in: twenty seconds of ceiling left, and a two-minute renewal asked
    // for. The renewal must lose.
    atTime(1_000_000 + 3_580_000);
    await run(store.touch(sessionId, 120));

    expect(fake.commands).toContainEqual({
      command: 'set',
      args: [
        `${DEFAULT_SESSION_NAMESPACE}:${sessionId}`,
        expect.any(String),
        'EX',
        20,
      ],
    });
  });

  it('refuses to renew past the ceiling and drops the session', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    atTime(1_000_000);
    const sessionId = await run(store.create(sampleData, lifetime));

    atTime(1_000_000 + 3_601_000);
    const error = await runFailure(store.touch(sessionId, 120));

    expect(error._tag).toBe('EntifixLogicError');
    // Gone from the store AND from the index, so a session list cannot show a
    // row that can never be renewed again.
    expect(
      fake.read(`${DEFAULT_SESSION_NAMESPACE}:${sessionId}`),
    ).toBeUndefined();
    expect(fake.commands).toContainEqual({
      command: 'srem',
      args: [`${DEFAULT_SESSION_NAMESPACE}:user:user-1`, sessionId],
    });
  });

  it('revokes a session and drops it from the user index', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const sessionId = await run(store.create(sampleData, lifetime));

    await run(store.revoke(sessionId));

    expect(
      fake.read(`${DEFAULT_SESSION_NAMESPACE}:${sessionId}`),
    ).toBeUndefined();
    await expect(runFailure(store.read(sessionId))).resolves.toMatchObject({
      _tag: 'EntifixLogicError',
    });
    expect(fake.commands).toContainEqual({
      command: 'srem',
      args: [`${DEFAULT_SESSION_NAMESPACE}:user:user-1`, sessionId],
    });
  });

  it('revoking an already-absent session skips the index cleanup', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    await run(store.revoke('absent'));

    expect(fake.commands.some(c => c.command === 'srem')).toBe(false);
  });

  it('revokes every session for a user', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const first = await run(store.create(sampleData, lifetime));
    const second = await run(store.create(sampleData, lifetime));

    await run(store.revokeAllForUser('user-1'));

    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${first}`)).toBeUndefined();
    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${second}`)).toBeUndefined();
  });

  // Sessions outlive a deploy. A record written before `absoluteExpiresAt`
  // existed used to parse into NaN and ask Redis to `EX NaN`, so everyone who
  // was signed in at deploy time got a 500 on their next refresh.
  describe('a session written before the ceiling existed', () => {
    const legacyRecord = (sessionId: string, expiresAt: string) =>
      JSON.stringify({
        ...sampleData,
        sessionId,
        createdAt: '2026-07-25T02:46:33.462Z',
        expiresAt,
      });

    it('renews, adopting its own expiry as the ceiling', async () => {
      const { fake, redis } = withFakeRedis();
      const store = makeRedisSessionStore(redis);
      atTime(Date.parse('2026-07-26T00:00:00.000Z'));
      const sessionId = 'legacy-session';
      await redis.set(
        `${DEFAULT_SESSION_NAMESPACE}:${sessionId}`,
        // A week out from creation — the bound the old policy gave it.
        legacyRecord(sessionId, '2026-08-01T02:46:33.462Z'),
      );

      await run(store.touch(sessionId, 60));

      // Renewed rather than exploding, and the rewritten record now carries a
      // ceiling, so it self-heals on first touch.
      const renewed = await run(store.read(sessionId));
      expect(renewed.absoluteExpiresAt).toBe('2026-08-01T02:46:33.462Z');
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

    it('is still capped by the bound it was created with', async () => {
      const { redis } = withFakeRedis();
      const store = makeRedisSessionStore(redis);
      atTime(Date.parse('2026-07-26T00:00:00.000Z'));
      const sessionId = 'legacy-expired';
      await redis.set(
        `${DEFAULT_SESSION_NAMESPACE}:${sessionId}`,
        legacyRecord(sessionId, '2026-07-25T02:46:33.462Z'),
      );

      const error = await runFailure(store.touch(sessionId, 60));

      expect(error._tag).toBe('EntifixLogicError');
    });

    it('reads back with a ceiling rather than undefined', async () => {
      const { redis } = withFakeRedis();
      const store = makeRedisSessionStore(redis);
      const sessionId = 'legacy-read';
      await redis.set(
        `${DEFAULT_SESSION_NAMESPACE}:${sessionId}`,
        legacyRecord(sessionId, '2026-08-01T02:46:33.462Z'),
      );

      // The session list renders this field; `undefined` would reach the UI.
      expect((await run(store.read(sessionId))).absoluteExpiresAt).toBe(
        '2026-08-01T02:46:33.462Z',
      );
    });
  });

  it('lists a user’s live sessions', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const first = await run(store.create(sampleData, lifetime));
    const second = await run(store.create(sampleData, lifetime));

    const sessions = await run(store.listForUser('user-1'));

    expect(sessions.map(record => record.sessionId).sort()).toEqual(
      [first, second].sort(),
    );
  });

  it('prunes index entries whose record already expired', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const kept = await run(store.create(sampleData, lifetime));
    const vanished = await run(store.create(sampleData, lifetime));
    // Redis expiring a record on its own leaves the index pointing at nothing.
    await redis.del(`${DEFAULT_SESSION_NAMESPACE}:${vanished}`);

    const sessions = await run(store.listForUser('user-1'));

    expect(sessions.map(record => record.sessionId)).toEqual([kept]);
    expect(fake.commands).toContainEqual({
      command: 'srem',
      args: [`${DEFAULT_SESSION_NAMESPACE}:user:user-1`, vanished],
    });
  });

  it('listing a user with no sessions returns empty', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    expect(await run(store.listForUser('ghost'))).toEqual([]);
  });

  it('revokes every session but the one held', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    const mine = await run(store.create(sampleData, lifetime));
    const other = await run(store.create(sampleData, lifetime));

    await run(store.revokeAllForUserExcept('user-1', mine));

    // A password change must not sign you out of the screen you are on.
    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${mine}`)).toBeDefined();
    expect(fake.read(`${DEFAULT_SESSION_NAMESPACE}:${other}`)).toBeUndefined();
    // …and the index must not keep pointing at the dead one.
    expect(await run(store.listForUser('user-1'))).toHaveLength(1);
  });

  it('revoking all-except for a user with no sessions is a no-op', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    await expect(
      run(store.revokeAllForUserExcept('ghost', 'whatever')),
    ).resolves.toBeUndefined();
  });

  it('revoking a user with no sessions is a no-op over an empty set', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);

    await expect(run(store.revokeAllForUser('ghost'))).resolves.toBeUndefined();
  });

  it('surfaces a driver failure as an EntifixConnError', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisSessionStore(redis);
    fake.failWith(new Error('connection reset'));

    const error = await runFailure(store.create(sampleData, lifetime));

    expect(error._tag).toBe('EntifixConnError');
  });

  it('provides SessionStoreTag through the layer', async () => {
    const { redis } = withFakeRedis();
    const layer = RedisSessionStoreLayer().pipe(
      Layer.provide(Layer.succeed(RedisTag, redis)),
    );

    const sessionId = await run(
      Effect.provide(
        Effect.flatMap(SessionStoreTag, store =>
          store.create(sampleData, lifetime),
        ),
        layer,
      ),
    );

    expect(sessionId).toEqual(expect.any(String));
  });
});
