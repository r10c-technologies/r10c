import { describe, expect, it } from 'vitest';

import {
  localeHref,
  negotiateLocale,
  parseAcceptLanguage,
  splitLocalePath,
} from './negotiate.js';

describe('splitLocalePath', () => {
  it('peels a locale off the first segment', () => {
    expect(splitLocalePath('/es/catalog/product')).toEqual({
      locale: 'es',
      rest: '/catalog/product',
    });
  });

  it('leaves a bare locale pointing at the root', () => {
    expect(splitLocalePath('/en')).toEqual({ locale: 'en', rest: '/' });
  });

  it('leaves an unprefixed path untouched', () => {
    expect(splitLocalePath('/catalog/product')).toEqual({
      rest: '/catalog/product',
    });
    expect(splitLocalePath('/')).toEqual({ rest: '/' });
  });

  it('normalises an empty pathname to the root', () => {
    expect(splitLocalePath('')).toEqual({ rest: '/' });
  });
});

describe('localeHref', () => {
  it('prefixes an in-app path', () => {
    expect(localeHref('es', '/catalog/product')).toBe('/es/catalog/product');
    expect(localeHref('en', '/')).toBe('/en');
  });

  it('is idempotent, so it is safe to apply blindly', () => {
    expect(localeHref('es', localeHref('es', '/catalog'))).toBe('/es/catalog');
  });

  it('leaves absolute and relative hrefs alone', () => {
    expect(localeHref('es', 'https://example.com/x')).toBe(
      'https://example.com/x',
    );
    expect(localeHref('es', '//example.com/x')).toBe('//example.com/x');
    expect(localeHref('es', 'mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(localeHref('es', 'product/1')).toBe('product/1');
  });
});

describe('parseAcceptLanguage', () => {
  it('honours q-values over declaration order', () => {
    expect(parseAcceptLanguage('en;q=0.4, es;q=0.9')).toBe('es');
  });

  it('matches a regional tag onto its base locale', () => {
    expect(parseAcceptLanguage('es-419,es;q=0.9')).toBe('es');
    expect(parseAcceptLanguage('EN-GB')).toBe('en');
  });

  it('skips languages we do not speak', () => {
    expect(parseAcceptLanguage('fr-FR,de;q=0.8,en;q=0.1')).toBe('en');
    expect(parseAcceptLanguage('fr-FR,de;q=0.8')).toBeUndefined();
  });

  it('ignores zero and unparseable qualities', () => {
    expect(parseAcceptLanguage('es;q=0, en')).toBe('en');
    expect(parseAcceptLanguage('es;q=nope, en')).toBe('en');
  });

  it('returns nothing for a missing header', () => {
    expect(parseAcceptLanguage(undefined)).toBeUndefined();
    expect(parseAcceptLanguage(null)).toBeUndefined();
    expect(parseAcceptLanguage('')).toBeUndefined();
    expect(parseAcceptLanguage(' , ')).toBeUndefined();
  });
});

describe('negotiateLocale', () => {
  it('lets an explicit path prefix win over everything', () => {
    expect(
      negotiateLocale({
        pathname: '/en/users',
        cookie: 'es',
        acceptLanguage: 'es',
      }),
    ).toBe('en');
  });

  it('falls back to the remembered choice', () => {
    expect(
      negotiateLocale({
        pathname: '/users',
        cookie: 'en',
        acceptLanguage: 'es',
      }),
    ).toBe('en');
  });

  it('falls back to the browser preference', () => {
    expect(
      negotiateLocale({
        pathname: '/users',
        cookie: null,
        acceptLanguage: 'en-US',
      }),
    ).toBe('en');
    expect(negotiateLocale({ cookie: 'fr', acceptLanguage: 'en' })).toBe('en');
  });

  it('falls back to the fleet default', () => {
    expect(negotiateLocale({})).toBe('es');
    expect(negotiateLocale({ pathname: '/users', acceptLanguage: 'fr' })).toBe(
      'es',
    );
  });
});
