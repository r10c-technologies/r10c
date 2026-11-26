import { describe, expect, it } from 'vitest';

import {
  MAX_VARIANT_VALUE_LENGTH,
  normalizedVariant,
  variantAxesKey,
  VariantInvalid,
  variantKeyOf,
  variantShapeRefusal,
  variantSiblingRefusal,
  variantValuesOf,
} from './variant.js';

describe('variantShapeRefusal', () => {
  it('accepts no variant at all, and a well-formed one', () => {
    expect(variantShapeRefusal([])).toBeUndefined();
    expect(
      variantShapeRefusal([
        { axis: 'size', value: '40' },
        { axis: 'color', value: 'café' },
      ]),
    ).toBeUndefined();
  });

  it.each([
    [[{ axis: 'flavour', value: 'x' }], 'axis'],
    [[{ axis: 'color', value: '  ' }], 'value'],
    [[{ axis: 'color', value: 7 }], 'value'],
    [
      [{ axis: 'color', value: 'x'.repeat(MAX_VARIANT_VALUE_LENGTH + 1) }],
      'value',
    ],
    [
      [
        { axis: 'color', value: 'negro' },
        { axis: 'color', value: 'azul' },
      ],
      'repeatedAxis',
    ],
    [
      [
        { axis: 'color', value: 'a' },
        { axis: 'size', value: 'b' },
        { axis: 'finish', value: 'c' },
        { axis: 'capacity', value: 'd' },
      ],
      'tooMany',
    ],
  ] as const)('refuses %j as %s', (values, problem) => {
    expect(variantShapeRefusal(values)).toBe(problem);
  });
});

describe('the canonical form', () => {
  const values = [
    { axis: 'size', value: ' 40 ' },
    { axis: 'color', value: 'Café' },
  ] as const;

  it('orders by the axis list and trims', () => {
    expect(normalizedVariant(values)).toEqual([
      { axis: 'color', value: 'Café' },
      { axis: 'size', value: '40' },
    ]);
    expect(variantAxesKey(values)).toBe('color+size');
  });

  it('keys a combination accent- and case-blind', () => {
    expect(variantKeyOf(values)).toBe(
      variantKeyOf([
        { axis: 'color', value: 'cafe' },
        { axis: 'size', value: '40' },
      ]),
    );
  });
});

describe('variantSiblingRefusal', () => {
  const black = [{ axis: 'color', value: 'negro' }] as const;
  const blue = [{ axis: 'color', value: 'azul' }] as const;

  it('admits the first variant and a new combination', () => {
    expect(variantSiblingRefusal(black, [])).toBeUndefined();
    expect(variantSiblingRefusal(blue, [black])).toBeUndefined();
  });

  it('refuses other axes than the siblings take', () => {
    expect(
      variantSiblingRefusal([{ axis: 'size', value: '40' }], [black]),
    ).toBe('axesMismatch');
  });

  it('refuses a combination a sibling already takes, under any spelling', () => {
    expect(
      variantSiblingRefusal([{ axis: 'color', value: 'NEGRO' }], [black]),
    ).toBe('combinationTaken');
  });
});

describe('variantValuesOf', () => {
  it('reads a stored variant in canonical form', () => {
    expect(
      variantValuesOf([
        { axis: 'size', value: '40' },
        { axis: 'color', value: 'negro' },
      ]),
    ).toEqual([
      { axis: 'color', value: 'negro' },
      { axis: 'size', value: '40' },
    ]);
  });

  it.each([undefined, 'negro', [], [null], [{ axis: 'flavour', value: 'x' }]])(
    'reads %j as no variant',
    value => {
      expect(variantValuesOf(value)).toBeUndefined();
    },
  );
});

describe('VariantInvalid', () => {
  it('carries its problem under the catalog code', () => {
    const failure = new VariantInvalid({ problem: 'combinationTaken' });
    expect(failure.code).toBe('variantInvalid');
    expect(failure.message).toContain('combinationTaken');
  });
});
