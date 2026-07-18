import type { EntifixConnError, EntifixLockError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/** A held lock; `token` proves ownership so release only frees our own lock. */
export interface LockHandle {
  key: string;
  token: string;
}

/**
 * Distributed mutual exclusion — the facade's `lock`/`free` steps. Implemented
 * over Redis (`SET NX PX` + bounded retry) in `entifix-ts-redis-client`.
 */
export interface LockService {
  /**
   * Acquire `key`, retrying up to the adapter's bounded budget. Fails with
   * {@link EntifixLockError} on contention (surfaced as `409`), not a `500`.
   */
  acquire(key: string): Effect.Effect<LockHandle, EntifixLockError>;
  release(handle: LockHandle): Effect.Effect<void, EntifixConnError>;
}

export class LockServiceTag extends Context.Tag('LockServiceTag')<
  LockServiceTag,
  LockService
>() {}
