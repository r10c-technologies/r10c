import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/**
 * A monotonic, gap-free-under-contention counter — the mechanism that makes
 * codes unique across service instances. Implemented as Redis `INCR` in
 * `entifix-ts-redis-client`; the atomicity of `INCR` is what guarantees no two
 * concurrent commands ever draw the same number.
 */
export interface SequenceService {
  /** Atomically increments the named sequence and returns the new value. */
  next(name: string): Effect.Effect<number, EntifixConnError>;
}

export class SequenceServiceTag extends Context.Tag('SequenceServiceTag')<
  SequenceServiceTag,
  SequenceService
>() {}
