import { describe, expect, it } from 'vitest';

import { publishedVendorApi } from './published-vendor-api.js';

describe('the published-vendor declaration', () => {
  it('serves the sellers’ names to anyone, and writes nothing', () => {
    expect(publishedVendorApi.key).toBe('published-vendor');
    expect(publishedVendorApi.options).toEqual({
      verbs: ['list', 'get'],
      guard: { kind: 'public' },
    });
  });
});
