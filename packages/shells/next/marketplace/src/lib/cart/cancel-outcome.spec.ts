import { describe, expect, it } from 'vitest';

import { cancelStartOf, isCancelOutcome } from './cancel-outcome';

const accepted = (flowId: unknown) => ({
  meta: { type: 'flowAccepted' },
  data: { flowId, links: [] },
});

describe('cancelStartOf', () => {
  it('reads a 202 flowAccepted as a cancellation started, to follow', () => {
    expect(cancelStartOf(202, accepted('f-1'))).toEqual({
      kind: 'started',
      flowId: 'f-1',
    });
  });

  it('reads a 2xx that is no flowAccepted, or names no flow, as failed', () => {
    expect(cancelStartOf(200, accepted('f-1'))).toEqual({ kind: 'failed' });
    expect(cancelStartOf(202, { data: { flowId: 'f-1' } })).toEqual({
      kind: 'failed',
    });
    expect(cancelStartOf(202, accepted(''))).toEqual({ kind: 'failed' });
    expect(cancelStartOf(202, accepted(7))).toEqual({ kind: 'failed' });
  });

  /** #387: a cancel clicked before `payment.captured` was consumed. */
  it('reads a pending payment as worth retrying', () => {
    expect(cancelStartOf(409, { code: 'paymentPending' })).toEqual({
      kind: 'pending',
    });
  });

  it('reads every other refusal, and no answer at all, as failed', () => {
    for (const [status, code] of [
      [409, 'orderNotCancellable'],
      [401, 'cancelNotAuthorized'],
      [401, 'paymentPending'],
      [500, undefined],
    ] as const)
      expect(cancelStartOf(status, { code })).toEqual({ kind: 'failed' });
    expect(cancelStartOf(undefined, undefined)).toEqual({ kind: 'failed' });
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
