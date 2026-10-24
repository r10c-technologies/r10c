import { describe, expect, it } from 'vitest';

import {
  cartCount,
  MAX_QUANTITY,
  parseCart,
  serializeCart,
  withAdded,
  withQuantity,
} from './cart-state';

describe('parseCart', () => {
  it('reads `offeringId:qty` pairs', () => {
    expect(parseCart('offering-1:2,offering-2:1')).toEqual([
      { offeringId: 'offering-1', quantity: 2 },
      { offeringId: 'offering-2', quantity: 1 },
    ]);
  });

  it('treats an absent or empty cookie as an empty cart', () => {
    expect(parseCart(undefined)).toEqual([]);
    expect(parseCart('')).toEqual([]);
  });

  /**
   * The cookie is visitor-writable — anyone can open dev tools and edit it — so
   * every entry is a claim to be checked, not data to be trusted. A junk entry
   * is dropped rather than allowed to render `NaN` items or a negative total.
   */
  it('drops entries it cannot trust', () => {
    expect(parseCart('offering-1:abc,:3,offering-2:0,offering-3:-2')).toEqual(
      [],
    );
  });

  it('keeps the good entries beside the bad ones', () => {
    expect(parseCart('offering-1:oops,offering-2:2')).toEqual([
      { offeringId: 'offering-2', quantity: 2 },
    ]);
  });

  it('floors a fractional quantity', () => {
    expect(parseCart('offering-1:2.9')).toEqual([
      { offeringId: 'offering-1', quantity: 2 },
    ]);
  });
});

describe('serializeCart', () => {
  it('round-trips through parseCart', () => {
    const lines = [
      { offeringId: 'offering-1', quantity: 2 },
      { offeringId: 'offering-2', quantity: 1 },
    ];

    expect(parseCart(serializeCart(lines))).toEqual(lines);
  });

  it('writes an empty cart as an empty string', () => {
    expect(serializeCart([])).toBe('');
  });
});

describe('cartCount', () => {
  it('totals the units, not the lines', () => {
    expect(
      cartCount([
        { offeringId: 'offering-1', quantity: 2 },
        { offeringId: 'offering-2', quantity: 3 },
      ]),
    ).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(cartCount([])).toBe(0);
  });
});

describe('withAdded', () => {
  it('starts a line at one unit', () => {
    expect(withAdded([], 'offering-1')).toEqual([
      { offeringId: 'offering-1', quantity: 1 },
    ]);
  });

  it('adds a unit to the line already there, and leaves the others', () => {
    expect(
      withAdded(
        [
          { offeringId: 'offering-1', quantity: 2 },
          { offeringId: 'offering-2', quantity: 1 },
        ],
        'offering-1',
      ),
    ).toEqual([
      { offeringId: 'offering-1', quantity: 3 },
      { offeringId: 'offering-2', quantity: 1 },
    ]);
  });

  it('adds as many units as it is asked for, floored', () => {
    expect(withAdded([], 'offering-1', 3.6)).toEqual([
      { offeringId: 'offering-1', quantity: 3 },
    ]);
    expect(
      withAdded([{ offeringId: 'offering-1', quantity: 2 }], 'offering-1', 2),
    ).toEqual([{ offeringId: 'offering-1', quantity: 4 }]);
  });

  it('adds nothing for a count that is not a positive number', () => {
    const lines = [{ offeringId: 'offering-1', quantity: 2 }];
    expect(withAdded(lines, 'offering-1', 0)).toEqual(lines);
    expect(withAdded(lines, 'offering-1', Number.NaN)).toEqual(lines);
    expect(withAdded([], 'offering-1', 0.5)).toEqual([]);
  });

  it('stops at the most a line may hold', () => {
    expect(
      withAdded(
        [{ offeringId: 'offering-1', quantity: MAX_QUANTITY }],
        'offering-1',
      ),
    ).toEqual([{ offeringId: 'offering-1', quantity: MAX_QUANTITY }]);
  });
});

describe('withQuantity', () => {
  const lines = [
    { offeringId: 'offering-1', quantity: 2 },
    { offeringId: 'offering-2', quantity: 1 },
  ];

  it('sets one line and leaves the others', () => {
    expect(withQuantity(lines, 'offering-1', 5)).toEqual([
      { offeringId: 'offering-1', quantity: 5 },
      { offeringId: 'offering-2', quantity: 1 },
    ]);
  });

  it('removes the line at zero, and below it', () => {
    expect(withQuantity(lines, 'offering-1', 0)).toEqual([lines[1]]);
    expect(withQuantity(lines, 'offering-1', -3)).toEqual([lines[1]]);
  });

  it('floors a fraction and clamps a figure past the most a line holds', () => {
    expect(withQuantity(lines, 'offering-2', 2.7)[1]?.quantity).toBe(2);
    expect(withQuantity(lines, 'offering-2', 1e9)[1]?.quantity).toBe(
      MAX_QUANTITY,
    );
  });

  it('leaves the cart alone for a quantity that is not a number', () => {
    expect(withQuantity(lines, 'offering-1', Number.NaN)).toEqual(lines);
  });
});
