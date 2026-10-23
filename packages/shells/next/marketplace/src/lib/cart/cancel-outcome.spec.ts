import { describe, expect, it } from 'vitest';

import { cancelOutcomeOf, isCancelOutcome } from './cancel-outcome';

describe('cancelOutcomeOf', () => {
  it('reads a 2xx as cancelled', () => {
    expect(cancelOutcomeOf(200, undefined)).toBe('cancelled');
    expect(cancelOutcomeOf(202, undefined)).toBe('cancelled');
  });

  /** #387: a cancel clicked before `payment.captured` was consumed. */
  it('reads a pending payment as worth retrying', () => {
    expect(cancelOutcomeOf(409, 'paymentPending')).toBe('pending');
  });

  it('reads every other refusal as failed', () => {
    expect(cancelOutcomeOf(409, 'orderNotCancellable')).toBe('failed');
    expect(cancelOutcomeOf(401, 'cancelNotAuthorized')).toBe('failed');
    expect(cancelOutcomeOf(401, 'paymentPending')).toBe('failed');
    expect(cancelOutcomeOf(500, undefined)).toBe('failed');
  });

  it('reads no response at all as failed', () => {
    expect(cancelOutcomeOf(undefined, undefined)).toBe('failed');
  });
});

describe('isCancelOutcome', () => {
  it('accepts the three outcomes', () => {
    expect(isCancelOutcome('cancelled')).toBe(true);
    expect(isCancelOutcome('pending')).toBe(true);
    expect(isCancelOutcome('failed')).toBe(true);
  });

  it('rejects anything else a query param could carry', () => {
    expect(isCancelOutcome('storefront.order.cancel')).toBe(false);
    expect(isCancelOutcome(undefined)).toBe(false);
    expect(isCancelOutcome(['failed'])).toBe(false);
  });
});
