// Unlike every other spec in the repo, this one resolves with `bundler` rather
// than `nodenext` (see tsconfig.spec.json). `next` ships no `exports` map, so
// NodeNext's ESM mode refuses the bare `next/server` subpath outright — and this
// is the only spec that imports Next directly.
import { LOCALE_COOKIE, LOCALE_HEADER } from '@r10c/entifix-ts-i18n/routing';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';

import { rememberLocale, resolveLocale, rewriteToLocale } from './with-locale';

function request(
  url: string,
  init: { cookie?: string; acceptLanguage?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (init.acceptLanguage) headers.set('accept-language', init.acceptLanguage);
  if (init.cookie) headers.set('cookie', `${LOCALE_COOKIE}=${init.cookie}`);

  return new NextRequest(new URL(url, 'http://localhost:3001'), { headers });
}

describe('resolveLocale', () => {
  it('takes the locale from the path and strips it', () => {
    const resolution = resolveLocale(request('/en/catalog/product'));

    expect(resolution.locale).toBe('en');
    expect(resolution.pathname).toBe('/catalog/product');
    expect(resolution.redirect).toBeUndefined();
  });

  it('redirects an unprefixed path to the negotiated locale', () => {
    const resolution = resolveLocale(request('/catalog', { acceptLanguage: 'en-GB' }));

    expect(resolution.locale).toBe('en');
    expect(resolution.redirect?.headers.get('location')).toBe(
      'http://localhost:3001/en/catalog',
    );
  });

  it('remembers the choice on the redirect, so the next visit skips negotiation', () => {
    const resolution = resolveLocale(request('/catalog', { acceptLanguage: 'en' }));

    expect(resolution.redirect?.cookies.get(LOCALE_COOKIE)?.value).toBe('en');
  });

  it('prefers the remembered choice over the browser preference', () => {
    const resolution = resolveLocale(
      request('/catalog', { cookie: 'en', acceptLanguage: 'es' }),
    );

    expect(resolution.locale).toBe('en');
  });

  it('falls back to the fleet default', () => {
    const resolution = resolveLocale(request('/catalog', { acceptLanguage: 'fr' }));

    expect(resolution.locale).toBe('es');
    expect(resolution.redirect?.headers.get('location')).toBe(
      'http://localhost:3001/es/catalog',
    );
  });

  it('keeps the query string across the redirect', () => {
    const resolution = resolveLocale(request('/workspace?tab=catalog%3Aproduct'));

    expect(resolution.redirect?.headers.get('location')).toBe(
      'http://localhost:3001/es/workspace?tab=catalog%3Aproduct',
    );
  });
});

describe('rewriteToLocale', () => {
  it('rewrites onto the unprefixed tree and tags the request with the locale', () => {
    const incoming = request('/en/catalog');
    const response = rewriteToLocale(incoming, resolveLocale(incoming));

    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'http://localhost:3001/catalog',
    );
    expect(response.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe('en');
    expect(response.cookies.get(LOCALE_COOKIE)?.value).toBe('en');
  });
});

describe('rememberLocale', () => {
  it('scopes the cookie to the whole host', () => {
    const response = NextResponse.next();
    rememberLocale(response, 'en');

    const cookie = response.cookies.get(LOCALE_COOKIE);
    expect(cookie?.value).toBe('en');
    expect(cookie?.path).toBe('/');
    expect(cookie?.sameSite).toBe('lax');
  });
});
