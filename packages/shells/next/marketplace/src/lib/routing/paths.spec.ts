import { describe, expect, it } from 'vitest';

import { storePaths } from './paths';

describe('storePaths', () => {
  it('builds locale-free paths — StoreLink adds the prefix', () => {
    expect(storePaths.home()).toBe('/');
    expect(storePaths.category('lighting')).toBe('/c/lighting');
    expect(storePaths.product('AUR-LAMP-01')).toBe('/p/AUR-LAMP-01');
    expect(storePaths.cart()).toBe('/cart');
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
