import { Effect } from 'effect';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRedisLifecycleCursor } from './lifecycle-cursor';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const fakeRedis = (stored: string | null, failing = false) => {
  const get = vi.fn(() =>
    failing ? Promise.reject(new Error('redis down')) : Promise.resolve(stored),
  );
  const set = vi.fn(() =>
    failing ? Promise.reject(new Error('redis down')) : Promise.resolve('OK'),
  );
  return { redis: { get, set } as unknown as Redis, get, set };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('makeRedisLifecycleCursor', () => {
  it('reaches back a day when nothing has been stored yet', async () => {
    const { redis } = fakeRedis(null);

    const since = await Effect.runPromise(makeRedisLifecycleCursor(redis).read);

    expect(since).toBe(new Date(NOW - DAY_MS).toISOString());
  });

  it('re-reads a minute before the stored cursor', async () => {
    // The overlap is the correctness argument, not a safety margin: a timestamp
    // cannot tell "newer than the last one I saw" from "recorded in the same
    // millisecond and already handled". Duplicate revokes are free; a cursor
    // that advanced past an event loses it for good.
    const { redis } = fakeRedis('2026-09-11T11:00:00.000Z');

    const since = await Effect.runPromise(makeRedisLifecycleCursor(redis).read);

    expect(since).toBe(
      new Date(
        Date.parse('2026-09-11T11:00:00.000Z') - MINUTE_MS,
      ).toISOString(),
    );
  });

  it('treats an empty stored value as no cursor', async () => {
    const { redis } = fakeRedis('');

    const since = await Effect.runPromise(makeRedisLifecycleCursor(redis).read);

    expect(since).toBe(new Date(NOW - DAY_MS).toISOString());
  });

  it('falls back to the lookback when Redis cannot be read', async () => {
    // A wider sweep, not a crashed daemon. Every effect downstream is a revoke,
    // so the cost of reading too much is duplicate work.
    const { redis } = fakeRedis(null, true);

    const since = await Effect.runPromise(makeRedisLifecycleCursor(redis).read);

    expect(since).toBe(new Date(NOW - DAY_MS).toISOString());
  });

  it('stores what the sweep reached', async () => {
    const { redis, set } = fakeRedis(null);

    await Effect.runPromise(
      makeRedisLifecycleCursor(redis).write('2026-09-11T11:30:00.000Z'),
    );

    expect(set).toHaveBeenCalledWith(
      'oidc:lifecycle-cursor',
      '2026-09-11T11:30:00.000Z',
    );
  });

  it('swallows a failed write rather than killing the daemon', async () => {
    // The next pass simply re-reads a wider window and revokes the same
    // sessions again, which changes nothing.
    const { redis } = fakeRedis(null, true);

    await expect(
      Effect.runPromise(
        makeRedisLifecycleCursor(redis).write('2026-09-11T11:30:00.000Z'),
      ),
    ).resolves.toBeUndefined();
  });
});
