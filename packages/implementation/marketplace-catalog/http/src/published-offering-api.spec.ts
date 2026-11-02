import { describe, expect, it } from 'vitest';

import { publishedOfferingApi } from './published-offering-api.js';

describe('the published-offering declaration', () => {
  it('serves the projection and its facet counts to anyone, and writes nothing', () => {
    expect(publishedOfferingApi.key).toBe('published-offering');
    expect(publishedOfferingApi.options).toEqual({
      verbs: ['list', 'get'],
      guard: { kind: 'public' },
      facets: true,
    });
  });
});
