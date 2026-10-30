import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { OfferingChanged } from './offering-flows/offering-flows.js';
import {
  IllegalOfferingTransition,
  OfferingHasNoPrice,
  OfferingHasNoSpecification,
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
