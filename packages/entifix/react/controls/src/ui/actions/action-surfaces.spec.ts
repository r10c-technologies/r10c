import {
  type UseCaseBinding,
  type UseCaseDescriptor,
  type UseCasePlacement,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  ACTION_SURFACES,
  type ActionSurface,
  surfaceFor,
  useCasesForSurface,
} from './action-surfaces';

const BINDINGS: UseCaseBinding[] = ['entity', 'collection', 'unbound'];
const PLACEMENTS: UseCasePlacement[] = [
  'context-dependent',
  'context-independent',
  'determining',
];

const descriptor = (
  binding: UseCaseBinding,
  placement: UseCasePlacement,
  key = `${binding}-${placement}`,
): UseCaseDescriptor => ({
  key,
  binding,
  placement,
  labelKey: `entity:widget.useCases.${key}`,
});

/**
 * The enforceable half of the action model (issue #109, ADR 0035).
 *
 * `binding` and `placement` are independent unions, so their product is the
 * real surface area — nine cells today, twelve the moment either union gains a
 * member. The failure this guards against is not a crash: it is a verb that is
 * declared, granted, exported, passes every `@r10c/slices` invariant and then
 * never renders, which reads to its author as a permission problem and sends
 * them looking in the wrong place.
 *
 * So every cell must be *decided* — mapped to a surface, or rejected with an
 * error that says what to do instead. Neither this spec nor the map may grow a
 * silent default.
 */
describe('the binding × placement product', () => {
  it.each(
    BINDINGS.flatMap(binding =>
      PLACEMENTS.map(placement => ({ binding, placement })),
    ),
  )('decides $binding + $placement', ({ binding, placement }) => {
    let surface: ActionSurface | undefined;
    let rejection: unknown;

    try {
      surface = surfaceFor(descriptor(binding, placement));
    } catch (error) {
      rejection = error;
    }

    // Exactly one of the two, never neither and never both.
    expect(surface === undefined).toBe(rejection !== undefined);

    if (surface !== undefined) {
      expect(ACTION_SURFACES).toContain(surface);
    } else {
      // A rejection has to name the fix, or it is a dead end.
      expect(String(rejection)).toContain('context-dependent');
    }
  });

  /**
   * The one rejected cell, named explicitly so removing the rejection is a
   * deliberate edit to this spec rather than an accident in the map.
   */
  it('rejects collection + determining, and only that', () => {
    const rejected = BINDINGS.flatMap(binding =>
      PLACEMENTS.filter(placement => {
        try {
          surfaceFor(descriptor(binding, placement));
          return false;
        } catch {
          return true;
        }
      }).map(placement => `${binding}:${placement}`),
    );

    expect(rejected).toEqual(['collection:determining']);
  });
});

describe('surfaceFor', () => {
  it.each([
    ['entity', 'context-independent', 'form-header'],
    ['entity', 'determining', 'form-footer'],
    ['entity', 'context-dependent', 'row-menu'],
    ['collection', 'context-dependent', 'bulk-bar'],
    ['collection', 'context-independent', 'table-toolbar'],
    ['unbound', 'context-dependent', 'command-palette'],
    ['unbound', 'context-independent', 'command-palette'],
    ['unbound', 'determining', 'command-palette'],
  ] as const)('routes %s + %s to %s', (binding, placement, expected) => {
    expect(surfaceFor(descriptor(binding, placement))).toBe(expected);
  });

  it('names the offending verb in the rejection', () => {
    expect(() =>
      surfaceFor(descriptor('collection', 'determining', 'settle-all')),
    ).toThrow(/settle-all/);
  });
});

describe('useCasesForSurface', () => {
  const all = [
    descriptor('entity', 'context-independent'),
    descriptor('entity', 'determining'),
    descriptor('collection', 'context-dependent'),
  ];

  it('returns only the surface’s own verbs, in declaration order', () => {
    expect(useCasesForSurface('form-header', all).map(one => one.key)).toEqual([
      'entity-context-independent',
    ]);
  });

  it('treats absent metadata as no verbs', () => {
    expect(useCasesForSurface('bulk-bar', undefined)).toEqual([]);
  });

  /**
   * The whole list is validated whichever surface asks, so an unrenderable
   * verb fails on the first screen that renders *any* action — not only on the
   * one that was going to show it.
   */
  it('throws for an unrenderable verb even when another surface is asked for', () => {
    expect(() =>
      useCasesForSurface('form-header', [
        ...all,
        descriptor('collection', 'determining'),
      ]),
    ).toThrow(/no surface renders/);
  });
});
