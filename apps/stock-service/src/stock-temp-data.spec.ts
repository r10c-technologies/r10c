import {
  HARDWARE_STORE,
  SEEDED_VENDORS,
  SHOEMAKING_SUPPLIES_STORE,
} from '@r10c/utils-ts-fleet';
import { describe, expect, it } from 'vitest';

import {
  stockItemTempDataFor,
  stockMovementTempDataFor,
} from './stock-temp-data';

const indexOf = (
  vendor: (typeof SEEDED_VENDORS)[number],
  key: string,
): number => vendor.products.findIndex(product => product.key === key);

describe('the seeded ledger', () => {
  // The catalog sells the cable by the metre: its stock is counted in metres
  // too, or every hold on it is refused `unitMismatch` (ADR 0082 §4).
  it('counts each offering in the unit it is sold in', () => {
    const cable = `product-offering-${indexOf(HARDWARE_STORE, 'cable-thhn-12') + 1}`;
    expect(
      stockItemTempDataFor(HARDWARE_STORE).find(
        item => item.offeringId === cable,
      ),
    ).toMatchObject({ unit: 'M', onHand: 300_000 });

    const screws = `product-offering-${indexOf(HARDWARE_STORE, 'tornillo-madera-8') + 1}`;
    expect(
      stockItemTempDataFor(HARDWARE_STORE).find(
        item => item.offeringId === screws,
      ),
    ).toMatchObject({ unit: 'UN', onHand: 12_000 });

    const yard = `sh-product-offering-${indexOf(SHOEMAKING_SUPPLIES_STORE, 'cuerina-negra') + 1}`;
    expect(
      stockItemTempDataFor(SHOEMAKING_SUPPLIES_STORE).find(
        item => item.offeringId === yard,
      ),
    ).toMatchObject({ unit: 'YD', onHand: 120_000 });
  });

  it('folds to what each store says it holds, unit by unit', () => {
    for (const vendor of SEEDED_VENDORS) {
      const items = stockItemTempDataFor(vendor);
      const movements = stockMovementTempDataFor(vendor);
      for (const item of items) {
        const own = movements.filter(
          movement => movement.offeringId === item.offeringId,
        );
        expect(own.every(movement => movement.unit === item.unit)).toBe(true);
        expect(
          own.reduce((total, movement) => total + movement.quantity, 0),
        ).toBe(item.onHand);
      }
      // One `receipt`, two and three movements all appear.
      expect(
        new Set(
          items.map(
            item =>
              movements.filter(
                movement => movement.offeringId === item.offeringId,
              ).length,
          ),
        ),
      ).toEqual(new Set([1, 2, 3]));
    }
  });

  it('leaves a sold-out product at zero and a stockless one with no row', () => {
    for (const vendor of SEEDED_VENDORS) {
      const items = stockItemTempDataFor(vendor);
      vendor.products.forEach((product, index) => {
        const item = items.find(
          candidate =>
            candidate.offeringId.endsWith(`product-offering-${index + 1}`) &&
            candidate.offeringId.startsWith(vendor.idPrefix),
        );
        if (product.stock === 'none') expect(item).toBeUndefined();
        if (product.stock === 'sold-out') expect(item?.onHand).toBe(0);
      });
    }
  });
});
