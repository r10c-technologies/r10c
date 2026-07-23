import { describe, expect, it } from 'vitest';

import { NoopTracker } from './noop-tracker.js';

describe('NoopTracker', () => {
  it('discards track and identify without throwing', () => {
    expect(() => NoopTracker.track('event', { a: 1 })).not.toThrow();
    expect(() => NoopTracker.identify('user', { plan: 'pro' })).not.toThrow();
  });

  it('resolves every flag to false', () => {
    expect(NoopTracker.flag('any-flag')).toBe(false);
  });
});
