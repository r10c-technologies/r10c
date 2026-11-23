import { describe, expect, it } from 'vitest';

import { cartNoticeQuery, parseCartNotice } from './cart-notice.js';

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

  it('round-trips a refused quantity with the rule it broke', () => {
    const query = new URLSearchParams(
      cartNoticeQuery({
        kind: 'refused',
        offeringId: 'cable',
        refusal: 'quantityOffStep',
      }),
    );

    expect(parseCartNotice(Object.fromEntries(query))).toEqual({
      kind: 'refused',
      offeringId: 'cable',
      refusal: 'quantityOffStep',
    });
  });

  it('keeps a removed quantity in its scale, past what a count would hold', () => {
    expect(parseCartNotice({ removed: 'cable', quantity: '9999000' })).toEqual({
      kind: 'removed',
      offeringId: 'cable',
      quantity: 9_999_000,
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
      'a count past what a number holds exactly',
      { removed: 'o-1', quantity: '9007199254740993' },
    ],
    ['a refusal naming no rule', { refused: 'o-1' }],
    ['a refusal no sale makes', { refused: 'o-1', refusal: 'notFound' }],
  ])('is nothing for %s', (_label, query) => {
    expect(parseCartNotice(query)).toBeUndefined();
  });
});
