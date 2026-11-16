import { describe, expect, it } from 'vitest';

import { safeReturn, withAddedNotice } from './return-to';

describe('safeReturn', () => {
  it('accepts a listing on this storefront, in the posted locale', () => {
    expect(safeReturn('/es/search?q=flange', 'es')).toBe('/es/search?q=flange');
    expect(safeReturn('/es/c/lighting', 'es')).toBe('/es/c/lighting');
    expect(safeReturn('/es', 'es')).toBe('/es');
    expect(safeReturn('/es?page=2', 'es')).toBe('/es?page=2');
  });

  it.each([
    ['another origin', 'https://example.com/x'],
    ['a protocol-relative host', '//example.com'],
    ['a backslash host', '/\\example.com'],
    ['a backslash further in', '/es/\\example.com'],
    ['a control character', '/es/\nsearch'],
    ['another locale', '/en/search'],
    ['a locale that only shares a prefix', '/esx/search'],
    ['a relative path', 'es/search'],
    ['nothing at all', ''],
  ])('refuses %s', (_, returnTo) => {
    expect(safeReturn(returnTo, 'es')).toBeUndefined();
  });

  it('refuses a field that is not text, or a form with no locale', () => {
    expect(safeReturn(null, 'es')).toBeUndefined();
    expect(safeReturn(new File([], 'x'), 'es')).toBeUndefined();
    expect(safeReturn('/es/search', '')).toBeUndefined();
  });
});

describe('withAddedNotice', () => {
  it('adds the notice to a path with no query', () => {
    expect(withAddedNotice('/es', 'offering-1')).toBe('/es?added=offering-1');
  });

  it('keeps the listing’s own query, and replaces an earlier notice', () => {
    expect(
      withAddedNotice('/es/search?q=lino&added=offering-0', 'offering-1'),
    ).toBe('/es/search?q=lino&added=offering-1');
    expect(
      withAddedNotice('/es/search?removed=offering-0&quantity=2', 'a b'),
    ).toBe('/es/search?added=a%20b');
  });
});
