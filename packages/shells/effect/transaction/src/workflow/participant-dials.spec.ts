import { ConfigurationClientInMemory } from '@entifix/core';
import {
  PARTICIPANT_DIALS,
  participantDialKey,
} from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  readAllParticipantDials,
  readParticipantDials,
} from './participant-dials.js';

/** ADR 0067's defaults, as config-service seeds them. */
const ROWS: Readonly<Record<string, string>> = {
  windowType: 'count',
  windowSize: '20',
  minimumCalls: '5',
  failureRateThreshold: '50',
  slowCallThresholdMs: '2000',
  slowCallRate: '80',
  waitInOpenMs: '10000',
  halfOpenPermits: '3',
  forcedState: 'closed',
  bulkheadPermits: '16',
  attemptTimeoutMs: '5000',
  stepBoundMs: '60000',
};

const storeOf = (overrides: Readonly<Record<string, string>> = {}) =>
  new ConfigurationClientInMemory({
    breaker: PARTICIPANT_DIALS.map(dial => ({
      key: participantDialKey('stock-service', dial),
      value: overrides[dial] ?? ROWS[dial],
    })),
  });

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  return exit._tag === 'Failure' ? String(exit.cause) : 'succeeded';
};

describe('a participant’s dials', () => {
  it('reads the rows into the engine’s terms, the two rates as fractions', async () => {
    expect(
      await Effect.runPromise(readParticipantDials(storeOf(), 'stock-service')),
    ).toEqual({
      breaker: {
        windowType: 'count',
        windowSize: 20,
        minimumCalls: 5,
        failureRateThreshold: 0.5,
        slowCallRateThreshold: 0.8,
        slowCallDurationMs: 2000,
        waitInOpenMs: 10_000,
        halfOpenPermits: 3,
      },
      forcedState: 'closed',
      bulkheadPermits: 16,
      bounds: { attemptTimeoutMs: 5000, stepTimeoutMs: 60_000 },
    });
  });

  it('refuses a word its dial does not take, naming the row and the words it does', async () => {
    expect(
      await failureOf(
        readParticipantDials(
          storeOf({ windowType: 'sliding' }),
          'stock-service',
        ),
      ),
    ).toContain('"stock-service.windowType" cannot be "sliding"');
    expect(
      await failureOf(
        readParticipantDials(storeOf({ forcedState: 'open' }), 'stock-service'),
      ),
    ).toContain('closed, forcedOpen, disabled');
  });

  it('reads every participant, and fails on one with no rows at all', async () => {
    expect(
      Object.keys(
        await Effect.runPromise(
          readAllParticipantDials(storeOf(), ['stock-service']),
        ),
      ),
    ).toEqual(['stock-service']);
    expect(
      await failureOf(
        readAllParticipantDials(storeOf(), ['stock-service', 'order-service']),
      ),
    ).toContain('order-service.windowType');
  });
});
