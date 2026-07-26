import type { EntifixError } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/** How a lock is standing right now. */
export interface LockState {
  readonly locked: boolean;
  /** Seconds until sign-ins are accepted again; 0 when not locked. */
  readonly retryAfterSeconds: number;
  /** True only on the attempt that tripped it, so the owner is told once. */
  readonly justLocked: boolean;
}

/**
 * Failed-sign-in accounting.
 *
 * A temporary lock is a denial-of-service handle by construction: anyone who
 * knows an email address can spend failures against it. Three things blunt
 * that, and the adapter must honour all of them —
 *
 *  1. failures are counted per **identifier + source**, and only escalate to an
 *     identifier-wide lock once they arrive from several sources, so one
 *     attacker on one address cannot lock a victim out;
 *  2. the lock **expires on its own**, needing no administrator;
 *  3. tripping it **notifies the account owner**, so a targeted attempt is
 *     visible rather than silent.
 *
 * Deliberately separate from `UserStatus.Suspended`, which is an administrator's
 * lasting decision. Conflating a transient event with a moderation action would
 * make a burst of bad passwords look like a judgement about the account.
 */
export interface AttemptLimiter {
  /** How things stand before credentials are even checked. */
  check(identifier: string, source: string): Effect<LockState, EntifixError>;
  /** Record a failure and report the resulting state. */
  fail(identifier: string, source: string): Effect<LockState, EntifixError>;
  /** Clear the counters after a successful sign-in. */
  succeed(identifier: string, source: string): Effect<void, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link AttemptLimiter}. */
export class AttemptLimiterTag extends Context.Tag('AttemptLimiterTag')<
  AttemptLimiterTag,
  AttemptLimiter
>() {}
