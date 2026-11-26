import { createReferenceLabels, ReferenceLabelsTag } from '@entifix/business';
import { extractMetaAccessors } from '@entifix/core';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { MARKETPLACE_ADMIN_CATALOG_SURFACES } from '../catalog-surfaces.js';
import { CATALOG_REFERENCE_LABELS } from './reference-labels.js';

describe('CATALOG_REFERENCE_LABELS', () => {
  it('names exactly the targets this shell’s surfaces reference', () => {
    // `createReferenceLabels` refuses a target whose id is not filterable or
    // whose label is not one hop — so building the registry is the check.
    const labels = Context.get(
      createReferenceLabels(CATALOG_REFERENCE_LABELS),
      ReferenceLabelsTag,
    );
    // Derived from the members themselves (#773): a reference no registration
    // names shows an id where a person needs a name (entifix 0030), and a
    // registration nothing references is a read nobody makes.
    const referenced = new Set(
      MARKETPLACE_ADMIN_CATALOG_SURFACES.flatMap(surface =>
        extractMetaAccessors(surface.entityConstructor).flatMap(accessor =>
          accessor.references === undefined
            ? []
            : [accessor.references.entity],
        ),
      ),
    );

    // Plus the seller: an order's and a statement's vendor column names it,
    // and this shell serves the vocabulary proxy it is read through.
    referenced.add('marketplace-vendor:published-vendor');

    expect([...labels.entities.keys()].sort()).toEqual([...referenced].sort());
  });
});
