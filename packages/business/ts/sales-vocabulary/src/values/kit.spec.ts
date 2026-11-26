import { describe, expect, it } from 'vitest';

import {
  isKitQuantity,
  KIT_MAX_COMPONENTS,
  KitInvalid,
  kitLineStockOf,
  kitShapeRefusal,
  kitStockListOf,
  kitStockOf,
  kitTakenOf,
} from './kit.js';

const one = (offeringId: string, quantity = 1) => ({ offeringId, quantity });

describe('kitShapeRefusal', () => {
  it('accepts a list of distinct components held in counts', () => {
    expect(
      kitShapeRefusal('kit', [one('case'), one('film', 2)]),
    ).toBeUndefined();
  });

  it('names what is wrong with the list alone', () => {
    expect(kitShapeRefusal('kit', [])).toBe('empty');
    expect(
      kitShapeRefusal(
        'kit',
        Array.from({ length: KIT_MAX_COMPONENTS + 1 }, (_, at) =>
          one(`c${String(at)}`),
        ),
      ),
    ).toBe('tooMany');
    expect(kitShapeRefusal('kit', [one('case', 0)])).toBe('quantity');
    expect(kitShapeRefusal('kit', [one('case', 1.5)])).toBe('quantity');
    expect(kitShapeRefusal('kit', [one('kit')])).toBe('self');
    expect(kitShapeRefusal('kit', [one('case'), one('case', 2)])).toBe(
      'duplicate',
    );
  });
});

describe('kitStockOf', () => {
  it('takes a plain component from its own stock, one per unit held', () => {
    expect(kitStockOf(one('case', 2), undefined)).toEqual({
      offeringId: 'case',
      quantity: 2,
      stockOfferingId: 'case',
      stockUnit: 'UN',
      stockQuantity: 2,
    });
  });

  it('takes a presentation from its base, its factor per unit held', () => {
    expect(
      kitStockOf(one('roll', 2), {
        stockOfferingId: 'cable',
        stockFactor: 100_000,
        stockUnit: 'M',
      }),
    ).toEqual({
      offeringId: 'roll',
      quantity: 2,
      stockOfferingId: 'cable',
      stockUnit: 'M',
      stockQuantity: 200_000,
    });
  });
});

describe('kitLineStockOf', () => {
  it('multiplies what one kit takes by the kits sold', () => {
    const kit = [
      kitStockOf(one('case'), undefined),
      kitStockOf(one('film', 2), undefined),
    ];

    expect(
      kitLineStockOf(3, kit).map(({ stockQuantity }) => stockQuantity),
    ).toEqual([3, 6]);
  });
});

describe('kitStockListOf', () => {
  const stock = kitStockOf(one('case'), undefined);

  it('reads a whole list back', () => {
    expect(kitStockListOf([stock])).toEqual([stock]);
  });

  it('holds nothing for an absent, empty or partial list', () => {
    expect(kitStockListOf(undefined)).toBeUndefined();
    expect(kitStockListOf([])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, offeringId: '' }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, stockOfferingId: 7 }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, stockUnit: 'XX' }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, stockQuantity: 0 }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, quantity: -1 }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, offeringId: 3 }])).toBeUndefined();
    expect(kitStockListOf([{ ...stock, stockOfferingId: '' }])).toBeUndefined();
  });
});

describe('KitInvalid', () => {
  it('is an invalid failure naming its problem', () => {
    const failure = new KitInvalid({ problem: 'componentIsKit' });

    expect(failure.code).toBe('kitInvalid');
    expect(failure.message).toBe('kit is refused: componentIsKit');
    expect(isKitQuantity(2)).toBe(true);
  });
});

describe('kitTakenOf', () => {
  it('copies a line’s components as plain values, and nothing for none', () => {
    const component = kitStockOf(one('case'), undefined);

    expect(kitTakenOf({ kitComponents: [component] })).toEqual({
      kitComponents: [component],
    });
    expect(kitTakenOf({ kitComponents: [] })).toEqual({});
    expect(kitTakenOf({})).toEqual({});
  });
});
