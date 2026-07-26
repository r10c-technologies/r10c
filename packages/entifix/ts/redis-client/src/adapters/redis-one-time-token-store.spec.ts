import { OneTimeTokenStoreTag } from '@r10c/entifix-ts-business';
import { run, runFailure } from '@r10c/entifix-ts-testing-unit';
import { makeFakeRedis } from '@r10c/entifix-ts-testing-unit/drivers';
import { Effect, Layer } from 'effect';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { RedisTag } from '../redis-connection/redis-connection.js';
import {
  DEFAULT_TOKEN_NAMESPACE,
  makeRedisOneTimeTokenStore,
  RedisOneTimeTokenStoreLayer,
} from './redis-one-time-token-store.js';

const withFakeRedis = () => {
  const fake = makeFakeRedis();
  return { fake, redis: fake.redis as Redis };
};

const PURPOSE = 'password-reset';

describe('makeRedisOneTimeTokenStore', () => {
  it('round-trips a token back to its subject', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);

    const token = await run(store.issue(PURPOSE, 'user-1', 900));

    expect(await run(store.consume(PURPOSE, token))).toBe('user-1');
  });

  it('mints an unguessable token', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);

    const first = await run(store.issue(PURPOSE, 'user-1', 900));
    const second = await run(store.issue(PURPOSE, 'user-1', 900));

    // 32 random bytes, base64url.
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).not.toBe(second);
  });

  it('stores only a hash of the token', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);

    const token = await run(store.issue(PURPOSE, 'user-1', 900));

    // A dump of Redis must yield nothing redeemable.
    expect(fake.read(`${DEFAULT_TOKEN_NAMESPACE}:${PURPOSE}:${token}`)).toBeUndefined();
    expect(
      fake.commands.some(command =>
        command.args.some(argument => String(argument).includes(token)),
      ),
    ).toBe(false);
  });

  it('spends the token on first use', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);
    const token = await run(store.issue(PURPOSE, 'user-1', 900));

    await run(store.consume(PURPOSE, token));
    const error = await runFailure(store.consume(PURPOSE, token));

    // A copy in a mail archive or a proxy log is already worthless.
    expect(error._tag).toBe('EntifixLogicError');
  });

  it('refuses a token minted for a different purpose', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);
    const token = await run(store.issue('email-verification', 'user-1', 900));

    const error = await runFailure(store.consume(PURPOSE, token));

    // Namespacing is what stops one flow's token being redeemed as another's.
    expect(error._tag).toBe('EntifixLogicError');
  });

  it('refuses a token that was never issued', async () => {
    const { redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);

    const error = await runFailure(store.consume(PURPOSE, 'invented'));

    expect(error._tag).toBe('EntifixLogicError');
  });

  it('honours a custom namespace', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis, { namespace: 'tok' });

    await run(store.issue(PURPOSE, 'user-1', 900));

    expect(
      fake.commands.some(command => String(command.args[0]).startsWith('tok:')),
    ).toBe(true);
  });

  it('surfaces a driver failure as an EntifixConnError', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);
    fake.failWith(new Error('connection reset'));

    const error = await runFailure(store.issue(PURPOSE, 'user-1', 900));

    expect(error._tag).toBe('EntifixConnError');
  });

  it('surfaces a driver failure on consume too', async () => {
    const { fake, redis } = withFakeRedis();
    const store = makeRedisOneTimeTokenStore(redis);
    fake.failWith(new Error('connection reset'));

    const error = await runFailure(store.consume(PURPOSE, 'anything'));

    expect(error._tag).toBe('EntifixConnError');
  });

  it('provides OneTimeTokenStoreTag through the layer', async () => {
    const { redis } = withFakeRedis();
    const layer = RedisOneTimeTokenStoreLayer().pipe(
      Layer.provide(Layer.succeed(RedisTag, redis)),
    );

    const token = await run(
      Effect.provide(
        Effect.flatMap(OneTimeTokenStoreTag, store =>
          store.issue(PURPOSE, 'user-1', 900),
        ),
        layer,
      ),
    );

    expect(token).toEqual(expect.any(String));
  });
});
