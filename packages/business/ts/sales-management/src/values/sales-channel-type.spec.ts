import { describe, expect, it } from 'vitest';

import { isSalesChannelType, SalesChannelTypes } from './sales-channel-type.js';

describe('SalesChannelTypes', () => {
  it('carries the four origins settlement can price separately', () => {
    expect(SalesChannelTypes).toEqual([
      'storefront',
      'counter',
      'phone',
      'external',
    ]);
  });
});

describe('isSalesChannelType', () => {
  it.each(SalesChannelTypes)('accepts %s', value => {
    expect(isSalesChannelType(value)).toBe(true);
  });

  it('rejects a string outside the set, because an unmatched type would have to\n    fall back to a commission rate nobody agreed to', () => {
    expect(isSalesChannelType('kiosk')).toBe(false);
  });

  it.each([undefined, null, 7, {}])('rejects the non-string %s', value => {
    expect(isSalesChannelType(value)).toBe(false);
  });
});
