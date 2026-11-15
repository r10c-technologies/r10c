import { createReferenceLabels, ReferenceLabelsTag } from '@entifix/business';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { SETTLEMENT_REFERENCE_LABELS } from './reference-labels.js';

describe('SETTLEMENT_REFERENCE_LABELS', () => {
  it('registers the run, whose id a reference can filter by', () => {
    const labels = Context.get(
      createReferenceLabels(SETTLEMENT_REFERENCE_LABELS),
      ReferenceLabelsTag,
    );

    expect([...labels.entities.keys()]).toEqual([
      'settlement-management:settlement-run',
    ]);
  });
});
