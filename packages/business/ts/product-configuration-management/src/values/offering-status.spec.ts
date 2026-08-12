import { describe, expect, it } from 'vitest';

import { isOfferingStatus, OfferingStatuses } from './offering-status.js';

describe('OfferingStatuses', () => {
  it('runs draft to unpublished, in lifecycle order', () => {
    expect(OfferingStatuses).toEqual([
      'draft',
      'pending-review',
      'published',
      'unpublished',
    ]);
  });

  it('opens in `draft`, so authoring never publishes by omission', () => {
    expect(OfferingStatuses[0]).toBe('draft');
  });
});

describe('isOfferingStatus', () => {
  it('accepts every declared status', () => {
    for (const status of OfferingStatuses) {
      expect(isOfferingStatus(status)).toBe(true);
    }
  });

  it('rejects a string outside the set', () => {
    expect(isOfferingStatus('archived')).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(isOfferingStatus(undefined)).toBe(false);
    expect(isOfferingStatus(['published'])).toBe(false);
  });
});
