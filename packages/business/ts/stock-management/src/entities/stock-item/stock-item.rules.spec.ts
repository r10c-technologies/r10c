import { describe, expect, it } from 'vitest';

import { StockMovement } from '../stock-movement/stock-movement.entity.js';
import { StockItem } from './stock-item.entity.js';
import { availability, foldOnHand, isReconciled } from './stock-item.rules.js';

const item = (onHand: number, reserved: number): StockItem => {
  const stockItem = new StockItem('offering-1');
  stockItem.onHand = onHand;
  stockItem.reserved = reserved;
  return stockItem;
};

describe('availability', () => {
  it('is what is held minus what is promised', () => {
    expect(availability(item(10, 3))).toBe(7);
  });

  it('goes negative when a correction lands below the live holds', () => {
    // Not clamped: this is the oversell the correction just revealed, and a
    // vendor has to be able to see it.
    expect(availability(item(2, 5))).toBe(-3);
  });
});

describe('foldOnHand', () => {
  it('is zero for a vendor who has recorded nothing', () => {
    expect(foldOnHand([])).toBe(0);
  });

  it('sums the signed quantities', () => {
    expect(
      foldOnHand([
        new StockMovement('offering-1', 50, 'receipt'),
        new StockMovement('offering-1', -3, 'sale'),
        new StockMovement('offering-1', 1, 'cancellation'),
      ]),
    ).toBe(48);
  });

  it('does not depend on the order the movements are replayed in', () => {
    const movements = [
      new StockMovement('offering-1', 50, 'receipt'),
      new StockMovement('offering-1', -3, 'sale'),
    ];
    expect(foldOnHand(movements)).toBe(foldOnHand([...movements].reverse()));
  });
});

describe('isReconciled', () => {
  it('holds when the materialized total equals its ledger', () => {
    expect(
      isReconciled(item(47, 0), [
        new StockMovement('offering-1', 50, 'receipt'),
        new StockMovement('offering-1', -3, 'sale'),
      ]),
    ).toBe(true);
  });

  it('fails when a total was written by something other than a movement', () => {
    expect(
      isReconciled(item(99, 0), [
        new StockMovement('offering-1', 50, 'receipt'),
      ]),
    ).toBe(false);
  });

  it('ignores `reserved`, which no movement ever moves', () => {
    // Reservations move `reserved`; the ledger says nothing about it, so
    // folding the two together would report every live hold as a discrepancy.
    expect(
      isReconciled(item(50, 8), [
        new StockMovement('offering-1', 50, 'receipt'),
      ]),
    ).toBe(true);
  });
});
