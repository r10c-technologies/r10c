import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { OfferingChanged } from './offering-flows/offering-flows.js';
import {
  SpecificationBeingRevised,
  SpecificationChanged,
  SpecificationNotTransitionable,
  SpecificationStillPinned,
} from './specification-lifecycle/specification-failures.js';
import {
  IllegalOfferingTransition,
  OfferingHasNoPrice,
  OfferingHasNoSpecification,
  SpecificationNotActive,
} from './transition-offering/transition-offering.js';

describe('the offering refusals', () => {
  it('are conflicts with the codes the errors catalog renders', () => {
    const refusals = [
      new IllegalOfferingTransition({
        id: 'o-1',
        from: 'draft',
        transition: 'unpublish',
      }),
      new OfferingHasNoPrice({ id: 'o-1' }),
      new OfferingHasNoSpecification({ id: 'o-1', specificationId: 's-9' }),
      new OfferingChanged({ id: 'o-1' }),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['illegalOfferingTransition', 'conflict'],
      ['offeringHasNoPrice', 'conflict'],
      ['offeringHasNoSpecification', 'conflict'],
      ['offeringChanged', 'conflict'],
    ]);
    expect(refusals[0]?.message).toBe(
      "an offering in 'draft' cannot be unpublished",
    );
    expect(refusals[1]?.message).toContain('needs a price');
    expect(refusals[2]?.message).toContain("'s-9'");
    expect(refusals[3]?.message).toContain('landed first');
  });
});

describe('the specification refusals', () => {
  it('are conflicts with the codes the errors catalog renders', () => {
    const refusals = [
      new SpecificationNotTransitionable({
        id: 's-1',
        standing: 'retired',
        move: 'release',
      }),
      new SpecificationBeingRevised({ specKey: 'product-001' }),
      new SpecificationStillPinned({ id: 's-1' }),
      new SpecificationChanged({ id: 's-1' }),
      new SpecificationNotActive({
        id: 'o-1',
        specificationId: 's-1',
        standing: 'in-design',
      }),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(refusals.map(refusal => [refusal.code, refusal.category])).toEqual([
      ['specificationNotTransitionable', 'conflict'],
      ['specificationBeingRevised', 'conflict'],
      ['specificationStillPinned', 'conflict'],
      ['specificationChanged', 'conflict'],
      ['specificationNotActive', 'conflict'],
    ]);
    expect(refusals.map(refusal => refusal.message)).toEqual([
      "a specification version that is 'retired' cannot release",
      "'product-001' already has a version in design; finish or delete it first",
      'a published offering still sells this version; move or unpublish it first',
      'another change to this specification landed first; reload it and try again',
      "this offering pins a specification version that is 'in-design'; only an active version may be published",
    ]);
  });
});
