import { describe, expect, it } from 'vitest';

import { stockItemTempData, stockMovementTempData } from './stock-temp-data';

describe('the seeded ledger', () => {
  // The catalog seed sells `product-offering-2` by the metre: its stock is
  // counted in metres too, or every hold on it is refused `unitMismatch`
  // (ADR 0082 §4).
  it('counts each offering in the unit it is sold in', () => {
    const metre = stockItemTempData.find(
      item => item.offeringId === 'product-offering-2',
    );
    expect(metre).toMatchObject({ unit: 'M', onHand: 13_600 });
    expect(
      stockMovementTempData
        .filter(movement => movement.offeringId === 'product-offering-2')
        .map(movement => [movement.unit, movement.quantity]),
    ).toEqual([
      ['M', 17_000],
      ['M', -3_400],
    ]);
    expect(
      stockItemTempData.find(item => item.offeringId === 'product-offering-1')
        ?.unit,
    ).toBe('UN');
  });

  it('folds to the items it seeds, unit by unit', () => {
    for (const item of stockItemTempData) {
      const movements = stockMovementTempData.filter(
        movement => movement.offeringId === item.offeringId,
      );
      expect(movements.every(movement => movement.unit === item.unit)).toBe(
        true,
      );
      expect(
        movements.reduce((total, movement) => total + movement.quantity, 0),
      ).toBe(item.onHand);
    }
  });
});
