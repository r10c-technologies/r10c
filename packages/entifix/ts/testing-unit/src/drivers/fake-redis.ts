/**
 * A fake of the ioredis client, not of the lock/sequence ports.
 *
 * `makeRedisLockService`, `makeRedisSequenceService`, the session store, the
 * one-time token store and the attempt limiter all run unchanged on top of it,
 * so their real behaviour — `SET NX PX`, the bounded retry loop, the
 * compare-and-delete release script, `INCR`, `GETDEL` — is what the specs
 * exercise.
 *
 * Time does not pass: `EX`/`EXPIRE` are remembered so `TTL` can report them, but
 * nothing here expires on its own. Adapters that must be tested across an expiry
 * drive the clock themselves.
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
  const sets = new Map<string, Set<string>>();
  /** Seconds last requested per key, so `TTL` can answer something plausible. */
  const ttls = new Map<string, number>();
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
          argument => String(argument).toUpperCase() === 'NX',
        );
        if (nx && store.has(key)) return null;
        store.set(key, value);
        // Remember an `EX <seconds>` so a later `TTL` is not a lie.
        const exIndex = rest.findIndex(
          argument => String(argument).toUpperCase() === 'EX',
        );
        if (exIndex !== -1) ttls.set(key, Number(rest[exIndex + 1]));
        return 'OK';
      }),

    get: (key: string) => record('get', [key], () => store.get(key) ?? null),

    /**
     * `TTL`: seconds remaining, `-2` when the key is gone and `-1` when it has
     * no expiry. Time does not actually pass here, so this reports whatever TTL
     * was last set — enough for adapters that branch on "is it still alive".
     */
    ttl: (key: string) =>
      record('ttl', [key], () => {
        if (!store.has(key) && !sets.has(key)) return -2;
        return ttls.get(key) ?? -1;
      }),

    /** `GETDEL`: read and remove atomically — a single-use token redemption. */
    getdel: (key: string) =>
      record('getdel', [key], () => {
        const value = store.get(key) ?? null;
        store.delete(key);
        ttls.delete(key);
        return value;
      }),

    /** `SCARD`: how many members a set holds. */
    scard: (key: string) =>
      record('scard', [key], () => sets.get(key)?.size ?? 0),

    del: (key: string) =>
      record('del', [key], () => {
        // A key can hold a string or a set; drop whichever is there so the
        // session store's `del` frees both record keys and index-set keys.
        const hadString = store.delete(key);
        const hadSet = sets.delete(key);
        return hadString || hadSet ? 1 : 0;
      }),

    /** `SADD`: add a member to a set, returning how many were newly added (0/1). */
    sadd: (key: string, member: string) =>
      record('sadd', [key, member], () => {
        const set = sets.get(key) ?? new Set<string>();
        const isNew = !set.has(member);
        set.add(member);
        sets.set(key, set);
        return isNew ? 1 : 0;
      }),

    /** `SREM`: remove a member, returning how many were removed (0/1). */
    srem: (key: string, member: string) =>
      record('srem', [key, member], () =>
        sets.get(key)?.delete(member) ? 1 : 0,
      ),

    /** `SMEMBERS`: the set's members, or an empty array for a missing set. */
    smembers: (key: string) =>
      record('smembers', [key], () => [...(sets.get(key) ?? [])]),

    /**
     * `EXPIRE`: TTL is not enforced by this fake, so it only reports whether the
     * key exists (1) or not (0) — which is the branch the session adapter reads
     * to detect a vanished session on `touch`.
     */
    expire: (key: string, seconds: number) =>
      record('expire', [key, seconds], () => {
        if (!store.has(key) && !sets.has(key)) return 0;
        ttls.set(key, seconds);
        return 1;
      }),

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
    read: key => store.get(key),
    hold: (key, token = 'someone-else') => {
      store.set(key, token);
    },
    free: key => {
      store.delete(key);
    },
    failWith: error => {
      failure = error;
    },
    get commands() {
      return commands;
    },
    redis,
  };
};
