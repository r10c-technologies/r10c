import { describe, expect, it } from 'vitest';

import { DEMO_VENDOR, SEEDED_VENDORS } from './index.js';

describe('the seeded vendors', () => {
  it('starts with the demo vendor Alan is a member of', () => {
    expect(DEMO_VENDOR.organizationId).toBe('demo-organization');
    expect(SEEDED_VENDORS.length).toBeGreaterThanOrEqual(2);
  });

  it('gives every vendor its own id prefix, organization and slug', () => {
    // One published catalog keyed by offering id: a shared prefix would make
    // two vendors' publications overwrite each other.
    for (const key of ['idPrefix', 'organizationId', 'slug'] as const) {
      const values = SEEDED_VENDORS.map(vendor => vendor[key]);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
