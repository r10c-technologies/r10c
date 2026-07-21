import { it as effectIt } from '@effect/vitest';
import {
  describeLockServiceContract,
  describeSequenceServiceContract,
} from '@r10c/entifix-ts-testing-unit/contracts';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import { Duration, Effect, Exit, Fiber, TestClock } from 'effect';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import {
  LOCK_RETRIES,
  LOCK_RETRY_DELAY_MS,
  LOCK_TTL_MS,
  makeRedisLockService,
} from './redis-lock-service.js';
import { makeRedisSequenceService } from './redis-sequence-service.js';

/**
 * The adapters run unchanged against a fake ioredis client, so `SET NX PX`, the
 * bounded retry loop, and the compare-and-delete release script are the code
 * under test — not a reimplementation of them.
 */
const withFakeRedis = () => {
  const fake = makeFakeRedis();
  return { fake, redis: fake.redis as Redis };
};

describeLockServiceContract('redis adapter over a fake driver', () => {
  const { redis } = withFakeRedis();
  return makeRedisLockService(redis);
});

describeSequenceServiceContract('redis adapter over a fake driver', () => {
  const { redis } = withFakeRedis();
  return makeRedisSequenceService(redis);
});

describe('makeRedisLockService', () => {
  it('acquires with SET NX PX so acquisition is atomic across instances', async () => {
    const { fake, redis } = withFakeRedis();

    await Effect.runPromise(makeRedisLockService(redis).acquire('product:code'));

    expect(fake.commands[0]?.command).toBe('set');
    expect(fake.commands[0]?.args).toEqual([
      'product:code',
      expect.any(String),
      'PX',
      LOCK_TTL_MS,
      'NX',
    ]);
  });

  // The retry budget is bounded, so exhausting it means waiting out every
  // sleep. `it.effect` supplies a TestClock, so the 2s of retries costs no wall
  // clock at all — and asserting the attempt count proves the budget, which a
  // plain timeout never would.
  effectIt.effect(
    'gives up after exhausting the retry budget on a contended key',
    () =>
      Effect.gen(function* () {
        const { fake, redis } = withFakeRedis();
        fake.hold('product:code');

        const fiber = yield* Effect.fork(
          makeRedisLockService(redis).acquire('product:code'),
        );
        yield* TestClock.adjust(
          Duration.millis(LOCK_RETRIES * LOCK_RETRY_DELAY_MS),
        );
        const exit = yield* Fiber.await(fiber);

        expect(Exit.isFailure(exit)).toBe(true);
        expect(
          fake.commands.filter((entry) => entry.command === 'set'),
        ).toHaveLength(LOCK_RETRIES);
      }),
  );

  it('acquires as soon as a contended key is freed', async () => {
    const { fake, redis } = withFakeRedis();
    fake.hold('product:code');
    fake.free('product:code');

    const handle = await Effect.runPromise(
      makeRedisLockService(redis).acquire('product:code'),
    );

    expect(handle.key).toBe('product:code');
  });

  it('frees only its own lock', async () => {
    const { fake, redis } = withFakeRedis();
    const locks = makeRedisLockService(redis);
    const handle = await Effect.runPromise(locks.acquire('product:code'));

    await Effect.runPromise(
      locks.release({ key: handle.key, token: 'someone-elses-token' }),
    );

    expect(fake.read('product:code')).toBe(handle.token);
  });

  it('maps a driver failure onto EntifixConnError on release', async () => {
    const { fake, redis } = withFakeRedis();
    const locks = makeRedisLockService(redis);
    const handle = await Effect.runPromise(locks.acquire('product:code'));
    fake.failWith(new Error('connection reset'));

    const exit = await Effect.runPromiseExit(locks.release(handle));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('makeRedisSequenceService', () => {
  it('namespaces sequence keys so they never collide with lock keys', async () => {
    const { fake, redis } = withFakeRedis();

    await Effect.runPromise(makeRedisSequenceService(redis).next('product'));

    expect(fake.commands[0]).toEqual({ command: 'incr', args: ['seq:product'] });
  });

  it('maps a driver failure onto EntifixConnError', async () => {
    const { fake, redis } = withFakeRedis();
    fake.failWith(new Error('connection reset'));

    const exit = await Effect.runPromiseExit(
      makeRedisSequenceService(redis).next('product'),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
