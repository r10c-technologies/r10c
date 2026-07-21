/**
 * A fake of the ioredis client, not of the lock/sequence ports.
 *
 * `makeRedisLockService` and `makeRedisSequenceService` run unchanged on top of
 * it, so their real behaviour — `SET NX PX`, the bounded retry loop, the
 * compare-and-delete release script, `INCR` — is what the specs exercise.
 */

export interface FakeRedis {
  /** Current keys and values, for assertions about what the adapter wrote. */
  read(key: string): string | undefined;
  /** Pre-set a key so the next `SET NX` finds it taken — i.e. lock contention. */
  hold(key: string, token?: string): void;
  /** Drop a key, releasing contention. */
  free(key: string): void;
  /** Makes every subsequent command reject with `error`. */
  failWith(error: unknown): void;
  /** Every command issued, in order. */
  readonly commands: ReadonlyArray<{ command: string; args: unknown[] }>;
  /** The object to pass where an ioredis `Redis` is expected. */
  readonly redis: unknown;
}

export const makeFakeRedis = (): FakeRedis => {
  const store = new Map<string, string>();
  const commands: Array<{ command: string; args: unknown[] }> = [];
  let failure: unknown;

  const record = <TValue>(
    command: string,
    args: unknown[],
    produce: () => TValue,
  ): Promise<TValue> => {
    commands.push({ command, args });
    return failure !== undefined
      ? Promise.reject(failure)
      : Promise.resolve(produce());
  };

  const redis = {
    /**
     * Supports the one form the lock adapter issues:
     * `set(key, token, 'PX', ttl, 'NX')`. `NX` is what makes acquisition
     * atomic, so honouring it is the whole point of this fake.
     */
    set: (key: string, value: string, ...rest: unknown[]) =>
      record('set', [key, value, ...rest], () => {
        const nx = rest.some(
          (argument) => String(argument).toUpperCase() === 'NX',
        );
        if (nx && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),

    get: (key: string) => record('get', [key], () => store.get(key) ?? null),

    del: (key: string) =>
      record('del', [key], () => (store.delete(key) ? 1 : 0)),

    incr: (key: string) =>
      record('incr', [key], () => {
        const next = Number(store.get(key) ?? '0') + 1;
        store.set(key, String(next));
        return next;
      }),

    /**
     * The release script is a compare-and-delete: free the key only when it
     * still holds our own token. Rather than interpreting Lua, this reproduces
     * that one script's semantics.
     */
    eval: (_script: string, _numKeys: number, key: string, token: string) =>
      record('eval', [key, token], () => {
        if (store.get(key) !== token) return 0;
        store.delete(key);
        return 1;
      }),

    quit: () => record('quit', [], () => 'OK'),
  };

  return {
    read: (key) => store.get(key),
    hold: (key, token = 'someone-else') => {
      store.set(key, token);
    },
    free: (key) => {
      store.delete(key);
    },
    failWith: (error) => {
      failure = error;
    },
    get commands() {
      return commands;
    },
    redis,
  };
};
