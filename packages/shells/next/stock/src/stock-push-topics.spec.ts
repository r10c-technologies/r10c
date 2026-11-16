import { describe, expect, it } from 'vitest';

import { STOCK_PUSH_TOPICS } from './stock-push-topics';

describe('STOCK_PUSH_TOPICS', () => {
  it('names the stock position the realtime slice pushes', () => {
    expect(STOCK_PUSH_TOPICS).toEqual(['entity:stock-item']);
  });
});
