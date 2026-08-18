import { describe, expect, it } from 'vitest';

import {
  isSalesChannelStatus,
  SalesChannelStatuses,
} from './sales-channel-status.js';

describe('SalesChannelStatuses', () => {
  it('retires a channel by state rather than deletion, because every order\n    placed through one keeps referring to it', () => {
    expect(SalesChannelStatuses).toEqual(['active', 'inactive']);
  });
});

describe('isSalesChannelStatus', () => {
  it.each(SalesChannelStatuses)('accepts %s', value => {
    expect(isSalesChannelStatus(value)).toBe(true);
  });

  it('rejects a string outside the set', () => {
    expect(isSalesChannelStatus('archived')).toBe(false);
  });

  it.each([undefined, null, 0, []])('rejects the non-string %s', value => {
    expect(isSalesChannelStatus(value)).toBe(false);
  });
});
