import { describe, expect, it } from 'vitest';

import { cartCount, parseCart, serializeCart } from './cart-state';

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
