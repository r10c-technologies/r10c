import { describe, expect, it } from 'vitest';

import { redeemedGroup } from './access-redemption';

describe('redeemedGroup', () => {
  it('takes the group a redemption answered, and nothing else', () => {
    expect(redeemedGroup({ id: 'g-1' })).toBe('g-1');
    expect(redeemedGroup({ id: '' })).toBeUndefined();
    expect(redeemedGroup({ id: 7 })).toBeUndefined();
    expect(redeemedGroup(null)).toBeUndefined();
    expect(redeemedGroup(undefined)).toBeUndefined();
  });
});
