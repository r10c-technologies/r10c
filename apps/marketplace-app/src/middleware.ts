import { resolveLocale } from '@r10c/shells-next-i18n';
import { type NextRequest, NextResponse } from 'next/server';

/**
 * The storefront has no auth gate, so locale is the only reason this file
 * exists — and unlike the back-offices it only ever *redirects*.
 *
 * The other apps rewrite `/es/catalog` onto `/catalog` and carry the locale on
 * a request header. This one has a real `app/[locale]` segment, so the route
 * tree matches the prefixed path directly and there is nothing to rewrite. That
 * is the whole point: a header is a dynamic request input, and reading one
 * would opt every storefront route out of prerendering.
 *
 * The pass-through deliberately does not re-set the locale cookie either. A
 * `Set-Cookie` on an otherwise-static HTML response is what stops a shared
 * cache from serving it, and the redirect branch (inside `resolveLocale`)
 * already persists the choice on the one request that actually made one.
 */
export function middleware(request: NextRequest) {
  return resolveLocale(request).redirect ?? NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
