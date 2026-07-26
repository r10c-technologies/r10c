import { resolveLocale, rewriteToLocale } from '@r10c/shells-next-i18n';
import type { NextRequest } from 'next/server';

/**
 * The storefront has no auth gate, so locale is the only reason this file
 * exists: an unprefixed URL is redirected to its negotiated prefix, and a
 * prefixed one is rewritten onto the plain route tree with the locale on a
 * request header.
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  return locale.redirect ?? rewriteToLocale(request, locale);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api|favicon.ico).*)',
  ],
};
