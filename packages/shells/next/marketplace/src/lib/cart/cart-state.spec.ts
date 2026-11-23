import { describe, expect, it } from 'vitest';

import {
  cartCount,
  parseCart,
  serializeCart,
  withLine,
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

  // A quantity is a whole number in its unit's scale (ADR 0082 §2): a
  // fraction is no quantity at all, and flooring it would sell less than the
  // cookie says.
  it('drops a fractional quantity rather than flooring it', () => {
    expect(parseCart('offering-1:2.9,offering-2:3500')).toEqual([
      { offeringId: 'offering-2', quantity: 3500 },
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
  // 3.5 m of cable is stored as 3500: summing quantities across units
  // would say the cart holds 3,502 things.
  it('counts the lines, not the quantities', () => {
    expect(
      cartCount([
        { offeringId: 'offering-1', quantity: 2 },
        { offeringId: 'cable', quantity: 3500 },
      ]),
    ).toBe(2);
  });

  it('is zero for an empty cart', () => {
    expect(cartCount([])).toBe(0);
  });
});

describe('withLine', () => {
  it('appends a line at the quantity asked for', () => {
    expect(
      withLine([{ offeringId: 'lamp', quantity: 1 }], 'cable', 1500),
    ).toEqual([
      { offeringId: 'lamp', quantity: 1 },
      { offeringId: 'cable', quantity: 1500 },
    ]);
  });

  it('sets the line already there, and leaves the others', () => {
    expect(
      withLine(
        [
          { offeringId: 'offering-1', quantity: 2 },
          { offeringId: 'offering-2', quantity: 1 },
        ],
        'offering-1',
        5,
      ),
    ).toEqual([
      { offeringId: 'offering-1', quantity: 5 },
      { offeringId: 'offering-2', quantity: 1 },
    ]);
  });

  it('changes nothing for a quantity that is not a positive whole number', () => {
    const lines = [{ offeringId: 'offering-1', quantity: 2 }];
    expect(withLine(lines, 'offering-1', 0)).toEqual(lines);
    expect(withLine(lines, 'offering-1', -1)).toEqual(lines);
    expect(withLine(lines, 'offering-1', Number.NaN)).toEqual(lines);
    expect(withLine([], 'offering-1', 0.5)).toEqual([]);
  });

  // The cart holds what was asked; whether the offering sells it is the
  // action's to refuse (ADR 0082 §3), never a ceiling here.
  it('caps nothing', () => {
    expect(withLine([], 'cable', 9_999_000)).toEqual([
      { offeringId: 'cable', quantity: 9_999_000 },
    ]);
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

  it('removes the line at zero', () => {
    expect(withQuantity(lines, 'offering-1', 0)).toEqual([lines[1]]);
  });

  it('leaves the cart alone for anything else that is no quantity', () => {
    expect(withQuantity(lines, 'offering-1', Number.NaN)).toEqual(lines);
    expect(withQuantity(lines, 'offering-1', -3)).toEqual(lines);
    expect(withQuantity(lines, 'offering-2', 2.7)).toEqual(lines);
  });
});
