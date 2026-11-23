import { describe, expect, it } from 'vitest';

import { isReservableQuantity } from './reservable-quantity.js';

describe('isReservableQuantity', () => {
  it('accepts a whole number of units', () => {
    expect(isReservableQuantity(1)).toBe(true);
    expect(isReservableQuantity(50)).toBe(true);
  });

  it('refuses a fraction, which is a quantity that lost its unit (ADR 0082 §2)', () => {
    // 1.5 kg is held as 1500 in `KG`.
    expect(isReservableQuantity(1.5)).toBe(false);
    expect(isReservableQuantity(1500)).toBe(true);
  });

  it('refuses zero — a hold of nothing still takes a row and an id', () => {
    expect(isReservableQuantity(0)).toBe(false);
  });

  it('refuses a negative quantity, which would release stock through the route that takes it', () => {
    expect(isReservableQuantity(-1)).toBe(false);
  });

  it('refuses NaN and the infinities, which `$inc` writes unrecoverably', () => {
    expect(isReservableQuantity(Number.NaN)).toBe(false);
    expect(isReservableQuantity(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isReservableQuantity(Number.NEGATIVE_INFINITY)).toBe(false);
  });
});
