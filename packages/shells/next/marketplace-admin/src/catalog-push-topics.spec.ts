import { describe, expect, it } from 'vitest';

import { CATALOG_PUSH_TOPICS } from './catalog-push-topics';

describe('CATALOG_PUSH_TOPICS', () => {
  it('names the offering entity the realtime slice pushes', () => {
    expect(CATALOG_PUSH_TOPICS).toEqual(['entity:product-offering']);
  });
});
