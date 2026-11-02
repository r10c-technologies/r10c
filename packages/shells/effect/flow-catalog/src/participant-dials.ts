import type { FragmentCatalog } from '@entifix/business/flow';

import { flowCatalog } from './catalog.js';

/**
 * The dials every participant a flow calls has a row for, in group `breaker`
 * as `<participant>.<dial>` (ADR 0067): its breaker, its bulkhead and its step
 * bounds. Here rather than in the transaction shell because two readers need
 * the one list — the shell that composes the breaker from the rows, and
 * config-service's spec that fails a seed missing one — and only this package
 * is reachable from both.
 *
 * The attempt cap is not among them: a call's retries draw on the process's
 * retry budget, whose `maxAttempts` is transaction-service's own `retry` row.
 */
export const PARTICIPANT_DIALS = [
  'windowType',
  'windowSize',
  'minimumCalls',
  'failureRateThreshold',
  'slowCallThresholdMs',
  'slowCallRate',
  'waitInOpenMs',
  'halfOpenPermits',
  'forcedState',
  'bulkheadPermits',
  'attemptTimeoutMs',
  'stepBoundMs',
] as const;
export type ParticipantDial = (typeof PARTICIPANT_DIALS)[number];

/** The configuration group the dials sit in. */
export const PARTICIPANT_DIALS_GROUP = 'breaker';

/** The row key one participant's dial is read from. */
export const participantDialKey = (
  participant: string,
  dial: ParticipantDial,
) => `${participant}.${dial}`;

/**
 * Every participant a registered fragment calls, once each and sorted. A
 * fragment that names none — the commit point — calls nobody and needs no
 * dials.
 */
export const flowParticipants = (
  catalog: FragmentCatalog = flowCatalog,
): readonly string[] =>
  // `Array.from`, never a spread: SWC's loose helper turns `[...set]` into an
  // empty array (@r10c/conventions).
  Array.from(
    new Set(
      catalog.fragments.flatMap(({ participant }) =>
        participant === undefined ? [] : [participant],
      ),
    ),
  ).sort();
