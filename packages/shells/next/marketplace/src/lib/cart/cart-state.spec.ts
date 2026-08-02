import { describe, expect, it } from 'vitest';

import { cartCount, parseCart, serializeCart } from './cart-state';

describe('parseCart', () => {
  it('reads `code:qty` pairs', () => {
    expect(parseCart('AUR-LAMP-01:2,TER-MUG-01:1')).toEqual([
      { code: 'AUR-LAMP-01', quantity: 2 },
      { code: 'TER-MUG-01', quantity: 1 },
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
    expect(parseCart('AUR-LAMP-01:abc,:3,TER-MUG-01:0,NIM-THRW-01:-2')).toEqual(
      [],
    );
  });

  it('keeps the good entries beside the bad ones', () => {
    expect(parseCart('AUR-LAMP-01:oops,TER-MUG-01:2')).toEqual([
      { code: 'TER-MUG-01', quantity: 2 },
    ]);
  });

  it('floors a fractional quantity', () => {
    expect(parseCart('AUR-LAMP-01:2.9')).toEqual([
      { code: 'AUR-LAMP-01', quantity: 2 },
    ]);
  });
});

describe('serializeCart', () => {
  it('round-trips through parseCart', () => {
    const lines = [
      { code: 'AUR-LAMP-01', quantity: 2 },
      { code: 'TER-MUG-01', quantity: 1 },
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
        { code: 'AUR-LAMP-01', quantity: 2 },
        { code: 'TER-MUG-01', quantity: 3 },
      ]),
    ).toBe(5);
  });

  it('is zero for an empty cart', () => {
    expect(cartCount([])).toBe(0);
  });
});
