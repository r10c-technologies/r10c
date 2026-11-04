import { describe, expect, it } from 'vitest';

import { FULFILMENT_PUSH_TOPICS } from './fulfilment-push-topics';

describe('FULFILMENT_PUSH_TOPICS', () => {
  it('names the shipment entity the realtime slice pushes', () => {
    expect(FULFILMENT_PUSH_TOPICS).toEqual(['entity:shipping-order']);
  });
});
