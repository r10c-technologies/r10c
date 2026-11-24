import { describe, expect, it } from 'vitest';

import {
  isStockFactor,
  PRESENTATION_UNIT,
  StockSourceInvalid,
  stockSourceOf,
} from './stock-source.js';

describe('isStockFactor', () => {
  it.each([
    [1, true],
    [100_000, true],
    [0, false],
    [-1, false],
    [1.5, false],
    ['100', false],
  ] as const)('%s is a factor: %s', (value, expected) => {
    expect(isStockFactor(value)).toBe(expected);
  });
});

describe('stockSourceOf', () => {
  it('reads a whole source', () => {
    expect(
      stockSourceOf({
        stockOfferingId: 'o-1',
        stockFactor: 100_000,
        stockUnit: 'M',
        name: 'Rollo',
      }),
    ).toEqual({ stockOfferingId: 'o-1', stockFactor: 100_000, stockUnit: 'M' });
  });

  it.each([
    [{}],
    [{ stockOfferingId: '', stockFactor: 1, stockUnit: 'UN' }],
    [{ stockOfferingId: 'o-1', stockFactor: 0, stockUnit: 'UN' }],
    [{ stockOfferingId: 'o-1', stockFactor: 1, stockUnit: 'BOX' }],
  ])('reads none from %j', record => {
    expect(stockSourceOf(record)).toBeUndefined();
  });
});

describe('StockSourceInvalid', () => {
  it('names its problem under its catalog code', () => {
    const failure = new StockSourceInvalid({ problem: 'baseIsPresentation' });
    expect(failure.code).toBe('stockSourceInvalid');
    expect(failure.message).toBe('stock source is refused: baseIsPresentation');
  });

  it('sells a presentation in UN', () => {
    expect(PRESENTATION_UNIT).toBe('UN');
  });
});
