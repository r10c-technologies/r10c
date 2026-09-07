import { describe, expect, it } from 'vitest';

import { OfferingStatuses } from './offering-status.js';
import {
  isLegalOfferingTransition,
  offeringStatusAfter,
  OfferingTransitions,
} from './offering-transition.js';

describe('publishing', () => {
  /**
   * From every state, including `published` itself. Republication is not a
   * mistake to guard against — ADR 0009 makes it the mechanism by which a
   * vendor's edit reaches the storefront, replacing the projection wholesale.
   */
  it.each(OfferingStatuses)('is legal from %s', status => {
    expect(offeringStatusAfter(status, 'publish')).toBe('published');
  });

  it('covers every status the enum declares', () => {
    // Pinned so a fifth state cannot be added without deciding what publishing
    // does from it — the table would otherwise answer `undefined` and the verb
    // would refuse from a state nobody meant to forbid.
    expect(OfferingStatuses.length).toBe(4);
  });
});

describe('unpublishing', () => {
  it('is legal from published', () => {
    expect(offeringStatusAfter('published', 'unpublish')).toBe('unpublished');
  });

  /**
   * The one genuinely illegal move a person can ask for. It must refuse rather
   * than write `unpublished` over a draft, which would leave the offering in a
   * state its author never chose and cannot read as progress.
   */
  it.each(['draft', 'pending-review', 'unpublished'] as const)(
    'is refused from %s',
    status => {
      expect(offeringStatusAfter(status, 'unpublish')).toBeUndefined();
      expect(isLegalOfferingTransition(status, 'unpublish')).toBe(false);
    },
  );
});

describe('the transition table', () => {
  it('declares exactly the two verbs the use cases bind', () => {
    expect([...OfferingTransitions]).toEqual(['publish', 'unpublish']);
  });

  it('never produces a status the enum does not declare', () => {
    for (const status of OfferingStatuses) {
      for (const transition of OfferingTransitions) {
        const next = offeringStatusAfter(status, transition);
        if (next !== undefined) {
          expect(OfferingStatuses).toContain(next);
        }
      }
    }
  });

  it('agrees with itself about what is legal', () => {
    for (const status of OfferingStatuses) {
      for (const transition of OfferingTransitions) {
        expect(isLegalOfferingTransition(status, transition)).toBe(
          offeringStatusAfter(status, transition) !== undefined,
        );
      }
    }
  });
});
