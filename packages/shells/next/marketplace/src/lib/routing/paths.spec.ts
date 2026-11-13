import { describe, expect, it } from 'vitest';

import { parseTenderChoice, storePaths } from './paths';

describe('storePaths', () => {
  it('builds locale-free paths — StoreLink adds the prefix', () => {
    expect(storePaths.home()).toBe('/');
    expect(storePaths.category('lighting')).toBe('/c/lighting');
    expect(storePaths.offering('offering-1')).toBe('/p/offering-1');
    expect(storePaths.cart()).toBe('/cart');
    expect(storePaths.orderStatus('f 1')).toBe('/order/status/f%201');
  });

  it('omits the query when there is no search term', () => {
    expect(storePaths.search()).toBe('/search');
  });

  // A term reaches this from a URL or a form field, so it is arbitrary text.
  it('encodes a search term', () => {
    expect(storePaths.search('lámpara & mesa')).toBe(
      '/search?q=l%C3%A1mpara%20%26%20mesa',
    );
  });
});

describe('the tenders between the cart and the review', () => {
  it('carries a tender per seller on the query string, and nothing when none is chosen', () => {
    expect(storePaths.checkoutReview()).toBe('/cart/review');
    expect(storePaths.checkoutReview({ 'vendor-1': 'cod' })).toBe(
      '/cart/review?method%3Avendor-1=cod',
    );
    expect(storePaths.cart({ 'vendor-1': 'card', 'vendor-2': 'cod' })).toBe(
      '/cart?method%3Avendor-1=card&method%3Avendor-2=cod',
    );
    expect(
      storePaths.checkoutReview({ 'vendor-1': 'cod' }, { changed: '1' }),
    ).toBe('/cart/review?method%3Avendor-1=cod&changed=1');
    expect(storePaths.cart({}, { added: 'o-1' })).toBe('/cart?added=o-1');
  });

  it('reads back each seller’s tender, first value wins, and ignores the rest of the query', () => {
    expect(
      parseTenderChoice({
        'method:vendor-1': 'cod',
        'method:vendor-2': ['card', 'cod'],
        'method:vendor-3': undefined,
        checkout: 'failed',
      }),
    ).toEqual({ 'vendor-1': 'cod', 'vendor-2': 'card' });
    expect(parseTenderChoice(undefined)).toEqual({});
  });
});
