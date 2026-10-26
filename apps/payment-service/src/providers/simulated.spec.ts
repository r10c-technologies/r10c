import { describePaymentProviderContract } from '@r10c/business-ts-payment-management/testing';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIMULATED_SETTINGS,
  makeSimulatedPaymentProvider,
  readSimulatedOutcome,
} from './simulated.js';

for (const outcome of ['capture', 'authorize', 'decline'] as const) {
  describePaymentProviderContract(`the simulated provider set to ${outcome}`, () =>
    makeSimulatedPaymentProvider({ ...DEFAULT_SIMULATED_SETTINGS, outcome }),
  );
}

describe('readSimulatedOutcome', () => {
  it('reads the two named outcomes and falls back to capture', () => {
    expect(
      ['authorize', 'decline', 'capture', 'anything'].map(readSimulatedOutcome),
    ).toEqual(['authorize', 'decline', 'capture', 'capture']);
  });
});
