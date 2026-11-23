// es reads numbers as es-GT does — `1.5` is one and a half (ADR 0082 §2).
import '@r10c/business-ts-i18n/locales';

import { describe, expect, it } from 'vitest';

import {
  addedLine,
  type CartTerms,
  heldLineRefusal,
  setLine,
} from './cart-quantity';

/** Sold by the half metre from one metre, at Q45 the metre. */
const CABLE: CartTerms = {
  offeringId: 'cable',
  saleUnit: 'M',
  quantityStep: 500,
  quantityMinimum: 1000,
  amount: 4500,
  pricePer: 1,
};

/** Screws at Q7.50 the hundred, by the piece. */
const SCREWS: CartTerms = {
  offeringId: 'screws',
  saleUnit: 'UN',
  quantityStep: 1,
  quantityMinimum: 1,
  amount: 750,
  pricePer: 100,
};

describe('addedLine', () => {
  it('reads what the form asked for in the offering’s unit and locale', () => {
    expect(addedLine(CABLE, undefined, '3.5', 'es')).toEqual({
      quantity: 3500,
    });
    expect(addedLine(CABLE, undefined, '3.5', 'en')).toEqual({
      quantity: 3500,
    });
  });

  it('adds it to what the line already holds', () => {
    expect(addedLine(CABLE, 1000, '1.5', 'es')).toEqual({ quantity: 2500 });
  });

  it('starts a card’s add at the minimum, and steps a line already there', () => {
    expect(addedLine(CABLE, undefined, null, 'es')).toEqual({
      quantity: 1000,
    });
    expect(addedLine(CABLE, 1500, null, 'es')).toEqual({ quantity: 2000 });
    expect(addedLine(CABLE, undefined, '  ', 'es')).toEqual({
      quantity: 1000,
    });
  });

  // Refused, never rounded to the nearest quantity sold (ADR 0082 §3).
  it('refuses a quantity off the step, below the minimum or unreadable', () => {
    expect(addedLine(CABLE, undefined, '1.2', 'es')).toEqual({
      refusal: 'quantityOffStep',
    });
    expect(addedLine(CABLE, undefined, '0.5', 'es')).toEqual({
      refusal: 'quantityBelowMinimum',
    });
    expect(addedLine(CABLE, undefined, 'mucho', 'es')).toEqual({
      refusal: 'quantityUnreadable',
    });
    expect(addedLine(CABLE, undefined, '1.0005', 'es')).toEqual({
      refusal: 'quantityUnreadable',
    });
    expect(addedLine(CABLE, 9_999_000, null, 'es')).toEqual({
      refusal: 'quantityAboveMaximum',
    });
  });

  it('refuses a line that would cost less than a centavo', () => {
    // Q0.40 the hundred: one is Q0.004, which rounds to nothing.
    expect(addedLine({ ...SCREWS, amount: 40 }, undefined, '1', 'es')).toEqual({
      refusal: 'lineBelowOneMinorUnit',
    });
    expect(addedLine(SCREWS, undefined, '250', 'es')).toEqual({
      quantity: 250,
    });
  });
});

describe('setLine', () => {
  it('sets the quantity the field says', () => {
    expect(setLine(CABLE, '2', 'es')).toEqual({ quantity: 2000 });
  });

  it('lets zero through, which removes the line', () => {
    expect(setLine(CABLE, '0', 'es')).toEqual({ quantity: 0 });
  });

  it('refuses an empty field, unreadable text and a quantity not sold', () => {
    expect(setLine(CABLE, null, 'es')).toEqual({
      refusal: 'quantityUnreadable',
    });
    expect(setLine(CABLE, 'x', 'es')).toEqual({
      refusal: 'quantityUnreadable',
    });
    expect(setLine(CABLE, '2.25', 'es')).toEqual({
      refusal: 'quantityOffStep',
    });
  });
});

describe('heldLineRefusal', () => {
  it('passes a line the terms still sell', () => {
    expect(heldLineRefusal(CABLE, 1500)).toBeUndefined();
  });

  it('names what a step changed since the add breaks', () => {
    expect(heldLineRefusal({ ...CABLE, quantityStep: 1000 }, 1500)).toBe(
      'quantityOffStep',
    );
  });
});
