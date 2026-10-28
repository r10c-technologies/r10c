import { describe, expect, it } from 'vitest';

import { vendorSubscription } from './publish-vendor.js';

describe('the subscription this slice binds', () => {
  it('takes every organization event on a work queue the marketplace owns', () => {
    expect(vendorSubscription).toEqual({
      slice: 'marketplace',
      pattern: 'organization.*',
      mode: 'work',
      maxAttempts: 5,
    });
  });
});
