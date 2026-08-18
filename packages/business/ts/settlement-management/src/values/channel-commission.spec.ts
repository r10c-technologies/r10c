import { describe, expect, it } from 'vitest';

import {
  CommissionableChannelTypes,
  commissionForChannel,
} from './channel-commission.js';

describe('CommissionableChannelTypes', () => {
  it('mirrors sales-management`s SalesChannelTypes, which it cannot import', () => {
    // `business:domain` may never depend on another `business:domain`, so the
    // values are copied. Nothing keeps the two lists in step — this assertion is
    // what makes the drift visible in a diff (ADR 0024).
    expect(CommissionableChannelTypes).toEqual([
      'storefront',
      'counter',
      'phone',
      'external',
    ]);
  });
});

describe('commissionForChannel', () => {
  it('takes the channel`s own rate when the agreement sets one', () => {
    expect(commissionForChannel({ counter: 100 }, 800, 'counter')).toBe(100);
  });

  it('honours a rate of zero rather than falling through to the default', () => {
    // The whole reason per-channel rates exist is "we take nothing on your own
    // counter". A truthiness check would silently charge full commission.
    expect(commissionForChannel({ counter: 0 }, 800, 'counter')).toBe(0);
  });

  it('falls back to the default for a channel with no override', () => {
    expect(commissionForChannel({ counter: 0 }, 800, 'storefront')).toBe(800);
  });

  it('falls back when the agreement sets no channel rates at all', () => {
    expect(commissionForChannel(undefined, 800, 'counter')).toBe(800);
  });

  it('falls back for a line with no channel, which is every order placed\n    before channels existed', () => {
    expect(commissionForChannel({ counter: 0 }, 800, undefined)).toBe(800);
  });

  it('falls back for a channel type this package has never heard of, which is\n    what drift between the two copied lists looks like at runtime', () => {
    expect(commissionForChannel({ counter: 0 }, 800, 'kiosk')).toBe(800);
  });
});
