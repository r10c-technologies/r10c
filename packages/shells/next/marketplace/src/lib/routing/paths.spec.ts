import { describe, expect, it } from 'vitest';

import { storePaths } from './paths';

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

describe('the cart and the review step', () => {
  it('carries only what the page reads, and nothing about tenders (ADR 0076 §7)', () => {
    expect(storePaths.checkoutReview()).toBe('/cart/review');
    expect(storePaths.checkoutReview({ changed: '1' })).toBe(
      '/cart/review?changed=1',
    );
    expect(storePaths.cart()).toBe('/cart');
    expect(storePaths.cart({ added: 'o-1' })).toBe('/cart?added=o-1');
  });
});
