import { RedisTag } from '@entifix/redis';
import {
  IdTokenStoreTag,
  LifecycleCursorTag,
  ProviderSessionIndexTag,
  SESSION_ABSOLUTE_TTL_SECONDS,
} from '@r10c/business-ts-authn';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { IdTokenStoreLayer } from './id-token-store.js';
import { LifecycleCursorLayer } from './lifecycle-cursor.js';
import { ProviderSessionIndexLayer } from './provider-session-index.js';

/** The handful of ioredis commands these stores issue, over two maps. */
const fakeRedis = (failing = false) => {
  const strings = new Map<string, string>();
  const sets = new Map<string, string[]>();
  const expiries = new Map<string, number>();
  const guard = <A>(run: () => A) =>
    failing ? Promise.reject(new Error('redis down')) : Promise.resolve(run());
  const redis = {
    set: (key: string, value: string, _mode?: string, seconds?: number) =>
      guard(() => {
        strings.set(key, value);
        if (seconds !== undefined) expiries.set(key, seconds);
        return 'OK';
      }),
    get: (key: string) => guard(() => strings.get(key) ?? null),
    getdel: (key: string) =>
      guard(() => {
        const value = strings.get(key) ?? null;
        strings.delete(key);
        return value;
      }),
    sadd: (key: string, member: string) =>
      guard(() => {
        sets.set(key, [...(sets.get(key) ?? []), member]);
        return 1;
      }),
    expire: (key: string, seconds: number) =>
      guard(() => {
        expiries.set(key, seconds);
        return 1;
      }),
    smembers: (key: string) => guard(() => sets.get(key) ?? []),
    del: (key: string) =>
      guard(() => {
        sets.delete(key);
        return 1;
      }),
  } as unknown as Redis;
  return { redis, expiries };
};

const stores = (redis: Redis) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return {
        tokens: yield* IdTokenStoreTag,
        index: yield* ProviderSessionIndexTag,
        cursor: yield* LifecycleCursorTag,
      };
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          IdTokenStoreLayer,
          ProviderSessionIndexLayer,
          LifecycleCursorLayer,
        ).pipe(Layer.provide(Layer.succeed(RedisTag, redis))),
      ),
    ),
  );

describe('the id-token store', () => {
  it('remembers a token for the session’s ceiling, and gives it up once', async () => {
    const { redis, expiries } = fakeRedis();
    const { tokens } = await stores(redis);

    await Effect.runPromise(tokens.remember('s-1', 'id-token'));
    const first = await Effect.runPromise(tokens.take('s-1'));
    const second = await Effect.runPromise(tokens.take('s-1'));

    expect([first, second]).toEqual(['id-token', undefined]);
    expect(expiries.get('oidc:id-token:s-1')).toBe(
      SESSION_ABSOLUTE_TTL_SECONDS,
    );
  });

  it('swallows a store that is down, because the logout still revokes', async () => {
    const { tokens } = await stores(fakeRedis(true).redis);

    await Effect.runPromise(tokens.remember('s-1', 'id-token'));

    expect(await Effect.runPromise(tokens.take('s-1'))).toBeUndefined();
  });
});

describe('the provider-session index', () => {
  it('links every session a provider session opened, and empties the entry as it reads it', async () => {
    const { index } = await stores(fakeRedis().redis);

    await Effect.runPromise(index.link('sid-1', 's-1'));
    await Effect.runPromise(index.link('sid-1', 's-2'));
    const taken = await Effect.runPromise(index.take('sid-1'));
    const again = await Effect.runPromise(index.take('sid-1'));

    expect([taken, again]).toEqual([['s-1', 's-2'], []]);
  });

  it('answers a store that is down with nothing to revoke', async () => {
    const { index } = await stores(fakeRedis(true).redis);

    await Effect.runPromise(index.link('sid-1', 's-1'));

    expect(await Effect.runPromise(index.take('sid-1'))).toEqual([]);
  });
});

describe('the lifecycle cursor, through its layer', () => {
  it('writes and reads back where the reconciler got to', async () => {
    const { cursor } = await stores(fakeRedis().redis);

    await Effect.runPromise(cursor.write('2026-10-25T12:00:00.000Z'));

    expect(await Effect.runPromise(cursor.read)).toBe(
      '2026-10-25T11:59:00.000Z',
    );
  });
});
