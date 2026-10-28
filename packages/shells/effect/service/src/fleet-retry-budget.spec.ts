import {
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@entifix/core';
import { DEFAULT_RETRY_DIALS, RetryBudgetTag } from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { fleetRetryBudgetLayer, readRetryDials } from './fleet-retry-budget.js';

const storeOf = (plain: ConfigurationPlain) =>
  new ConfigurationClientInMemory(plain);

const retryRows = (dials: Record<string, unknown>): ConfigurationPlain => ({
  retry: Object.entries(dials).map(([key, value]) => ({ key, value })),
});

describe('readRetryDials', () => {
  it('reads every dial from the retry group', async () => {
    const dials = await Effect.runPromise(
      readRetryDials(
        storeOf(
          retryRows({
            maxAttempts: 2,
            budgetRatio: 0.2,
            budgetFloorPerSecond: 3,
            backoffBaseMs: 40,
            backoffCapMs: 900,
            adaptiveThrottlingK: 1.5,
            adaptiveThrottlingWindowMs: 60_000,
          }),
        ),
      ),
    );

    expect(dials).toEqual({
      maxAttempts: 2,
      budgetRatio: 0.2,
      budgetFloorPerSecond: 3,
      backoffBaseMs: 40,
      backoffCapMs: 900,
      adaptiveThrottlingK: 1.5,
      adaptiveThrottlingWindowMs: 60_000,
    });
  });

  it('keeps the entifix default for a dial with no row', async () => {
    const dials = await Effect.runPromise(
      readRetryDials(storeOf(retryRows({ maxAttempts: 2 }))),
    );

    expect(dials).toEqual({ ...DEFAULT_RETRY_DIALS, maxAttempts: 2 });
  });

  it('keeps the default for a dial that is not a number, rather than failing the boot', async () => {
    const dials = await Effect.runPromise(
      readRetryDials(storeOf(retryRows({ backoffCapMs: 'soon' }))),
    );

    expect(dials.backoffCapMs).toBe(DEFAULT_RETRY_DIALS.backoffCapMs);
  });
});

describe('fleetRetryBudgetLayer', () => {
  it('sizes the process budget by the dials it read', async () => {
    const layer = await Effect.runPromise(
      fleetRetryBudgetLayer(storeOf(retryRows({ maxAttempts: 2 }))),
    );
    const maxAttempts = await Effect.runPromise(
      Effect.gen(function* () {
        return (yield* RetryBudgetTag).dials.maxAttempts;
      }).pipe(Effect.provide(layer)),
    );

    expect(maxAttempts).toBe(2);
  });
});
