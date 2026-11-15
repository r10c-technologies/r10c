import { createReferenceLabels, ReferenceLabelsTag } from '@entifix/business';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { ORDER_REFERENCE_LABELS } from './reference-labels.js';

describe('ORDER_REFERENCE_LABELS', () => {
  it('registers the order, whose id a reference can filter by', () => {
    const labels = Context.get(
      createReferenceLabels(ORDER_REFERENCE_LABELS),
      ReferenceLabelsTag,
    );

    expect([...labels.entities.keys()]).toEqual([
      'order-management:product-order',
    ]);
  });
});
