import {
  type ConfigurationClientInMemory,
  EntifixBuildError,
} from '@entifix/core';
import type { BreakerDials } from '@entifix/transactions';
import type { FlowDials } from '@entifix/workflow';
import {
  PARTICIPANT_DIALS_GROUP,
  type ParticipantDial,
  participantDialKey,
} from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

/** An operator's override, applied at boot; `closed` leaves the window in charge. */
export type ForcedState = 'closed' | 'forcedOpen' | 'disabled';

/** One participant's guards, as its rows state them (ADR 0067). */
export interface ParticipantDials {
  readonly breaker: BreakerDials;
  readonly forcedState: ForcedState;
  readonly bulkheadPermits: number;
  readonly bounds: Omit<FlowDials, 'concurrency'>;
}

const oneOf = <A extends string>(
  allowed: readonly A[],
  key: string,
  value: string,
): Effect.Effect<A, EntifixBuildError> =>
  (allowed as readonly string[]).includes(value)
    ? Effect.succeed(value as A)
    : Effect.fail(
        new EntifixBuildError(
          `Configuration key "${key}" cannot be "${value}": it takes ${allowed.join(', ')}`,
          undefined,
          { key, value },
        ),
      );

/**
 * Reads one participant's dials from transaction-service's `breaker` rows.
 * Every dial is **required**: a participant with no breaker row would run on
 * entifix's defaults, which were sized for no dependency in particular, and
 * nothing would say so. The ADR states the two rates as percentages; the
 * engine takes fractions.
 */
export const readParticipantDials = (
  store: ConfigurationClientInMemory,
  participant: string,
) => {
  const group = store.in(PARTICIPANT_DIALS_GROUP);
  const key = (dial: ParticipantDial) => participantDialKey(participant, dial);
  const number = (dial: ParticipantDial) => group.getNumber(key(dial));
  const word = <A extends string>(
    dial: ParticipantDial,
    allowed: readonly A[],
  ) =>
    Effect.flatMap(group.getString(key(dial)), value =>
      oneOf(allowed, key(dial), value),
    );

  return Effect.all({
    windowType: word('windowType', ['count', 'time'] as const),
    windowSize: number('windowSize'),
    minimumCalls: number('minimumCalls'),
    failureRate: number('failureRateThreshold'),
    slowCallDurationMs: number('slowCallThresholdMs'),
    slowCallRate: number('slowCallRate'),
    waitInOpenMs: number('waitInOpenMs'),
    halfOpenPermits: number('halfOpenPermits'),
    forcedState: word('forcedState', [
      'closed',
      'forcedOpen',
      'disabled',
    ] as const),
    bulkheadPermits: number('bulkheadPermits'),
    attemptTimeoutMs: number('attemptTimeoutMs'),
    stepTimeoutMs: number('stepBoundMs'),
  }).pipe(
    Effect.map((row): ParticipantDials => ({
      breaker: {
        windowType: row.windowType,
        windowSize: row.windowSize,
        minimumCalls: row.minimumCalls,
        failureRateThreshold: row.failureRate / 100,
        slowCallRateThreshold: row.slowCallRate / 100,
        slowCallDurationMs: row.slowCallDurationMs,
        waitInOpenMs: row.waitInOpenMs,
        halfOpenPermits: row.halfOpenPermits,
      },
      forcedState: row.forcedState,
      bulkheadPermits: row.bulkheadPermits,
      bounds: {
        attemptTimeoutMs: row.attemptTimeoutMs,
        stepTimeoutMs: row.stepTimeoutMs,
      },
    })),
  );
};

/** Every participant's dials, by participant. */
export const readAllParticipantDials = (
  store: ConfigurationClientInMemory,
  participants: readonly string[],
) =>
  Effect.map(
    Effect.forEach(participants, participant =>
      Effect.map(
        readParticipantDials(store, participant),
        dials => [participant, dials] as const,
      ),
    ),
    entries =>
      Object.fromEntries(entries) as Readonly<Record<string, ParticipantDials>>,
  );
