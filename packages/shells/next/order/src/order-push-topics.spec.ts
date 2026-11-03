import { describe, expect, it } from 'vitest';

import { ORDER_PUSH_TOPICS } from './order-push-topics';

describe('ORDER_PUSH_TOPICS', () => {
  it('names the order entity the realtime slice pushes', () => {
    expect(ORDER_PUSH_TOPICS).toEqual(['entity:product-order']);
  });
});
