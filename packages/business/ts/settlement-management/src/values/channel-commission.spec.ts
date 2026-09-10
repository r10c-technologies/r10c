import { SalesChannelTypes } from '@r10c/business-ts-sales-vocabulary';
import { describe, expect, it } from 'vitest';

import { commissionForChannel } from './channel-commission.js';

describe('ChannelCommissionRates', () => {
  it('is keyed by the shared vocabulary, so there is no second list to drift', () => {
    // The mirroring assertion this replaces pinned a local copy of the four
    // literals against `sales-management`'s, because neither domain could import
    // the other. Both now read the same `business:policy` package, which is what
    // ADR 0056 built — so the check that made drift *visible* is gone along with
    // the drift it watched for.
    const everyType: Record<string, number> = Object.fromEntries(
      SalesChannelTypes.map((type, index) => [type, index * 100]),
    );

    expect(commissionForChannel(everyType, 800, 'counter')).toBe(100);
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
