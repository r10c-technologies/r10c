import { describe, expect, it } from 'vitest';

import { cartNoticeQuery, parseCartNotice } from './cart-notice.js';
import { MAX_QUANTITY } from './cart-state.js';

describe('a cart notice', () => {
  it('round-trips an add through the query an action writes', () => {
    const query = new URLSearchParams(
      cartNoticeQuery({ kind: 'added', offeringId: 'offering/1' }),
    );

    expect(parseCartNotice(Object.fromEntries(query))).toEqual({
      kind: 'added',
      offeringId: 'offering/1',
    });
  });

  it('round-trips a removal with the count Undo gives back', () => {
    const query = new URLSearchParams(
      cartNoticeQuery({ kind: 'removed', offeringId: 'o-1', quantity: 3 }),
    );

    expect(parseCartNotice(Object.fromEntries(query))).toEqual({
      kind: 'removed',
      offeringId: 'o-1',
      quantity: 3,
    });
  });

  it.each([
    ['no query at all', undefined],
    ['an empty one', {}],
    ['an empty id', { added: '' }],
    ['a repeated id', { added: ['a', 'b'] }],
    ['a removal with no count', { removed: 'o-1' }],
    ['a count of zero', { removed: 'o-1', quantity: '0' }],
    ['a fractional count', { removed: 'o-1', quantity: '1.5' }],
    [
      'a count past the cart',
      { removed: 'o-1', quantity: String(MAX_QUANTITY + 1) },
    ],
  ])('is nothing for %s', (_label, query) => {
    expect(parseCartNotice(query)).toBeUndefined();
  });
});
