import type { ConfigurationClientInMemory } from '@entifix/core';
import {
  DEFAULT_RETRY_DIALS,
  type RetryBudgetTag,
  type RetryDials,
} from '@entifix/transactions';
import { InMemoryRetryBudgetLayer } from '@entifix/transactions/engine';
import { Effect, type Layer } from 'effect';

/**
 * The retry dials a service reads from its config-service rows, group `retry`
 * ([ADR 0064](../../../../../docs/adr/0064-failures-reach-the-slice-shell.md),
 * entifix ADR 0014). A row that is absent keeps entifix's default, so a fleet
 * whose seed predates a dial still boots with a sane budget.
 */
export const readRetryDials = (
  store: ConfigurationClientInMemory,
): Effect.Effect<RetryDials> => {
  const group = store.in('retry');
  const dial = (key: keyof RetryDials) =>
    group.getOptionalNumber(key).pipe(
      Effect.map(value => value ?? DEFAULT_RETRY_DIALS[key]),
      Effect.orElseSucceed(() => DEFAULT_RETRY_DIALS[key]),
    );
  return Effect.all({
    maxAttempts: dial('maxAttempts'),
    budgetRatio: dial('budgetRatio'),
    budgetFloorPerSecond: dial('budgetFloorPerSecond'),
    backoffBaseMs: dial('backoffBaseMs'),
    backoffCapMs: dial('backoffCapMs'),
    adaptiveThrottlingK: dial('adaptiveThrottlingK'),
    adaptiveThrottlingWindowMs: dial('adaptiveThrottlingWindowMs'),
  });
};

/** The process's retry budget, sized by its dials. */
export const fleetRetryBudgetLayer = (
  store: ConfigurationClientInMemory,
): Effect.Effect<Layer.Layer<RetryBudgetTag>> =>
  Effect.map(readRetryDials(store), dials =>
    InMemoryRetryBudgetLayer({ dials }),
  );
