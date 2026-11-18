import { createReferenceLabels, ReferenceLabelsTag } from '@entifix/business';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { CATALOG_REFERENCE_LABELS } from './reference-labels.js';

describe('CATALOG_REFERENCE_LABELS', () => {
  it('names every target a back-office reference points into this shell for', () => {
    // `createReferenceLabels` refuses a target whose id is not filterable or
    // whose label is not one hop — so building the registry is the check.
    const labels = Context.get(
      createReferenceLabels(CATALOG_REFERENCE_LABELS),
      ReferenceLabelsTag,
    );

    expect([...labels.entities.keys()].sort()).toEqual([
      'catalog-reference:device-model',
      'catalog-reference:product-brand',
      'catalog-reference:product-category',
      'marketplace-vendor:published-vendor',
      'product-configuration-management:product-offering',
      'product-configuration-management:product-specification',
    ]);
  });
});
