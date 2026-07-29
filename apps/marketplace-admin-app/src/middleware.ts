import { localeHref } from '@r10c/entifix-ts-i18n/routing';
import {
  rememberLocale,
  resolveLocale,
  rewriteToLocale,
} from '@r10c/shells-next-i18n';
import { type NextRequest, NextResponse } from 'next/server';

// Access cookie set by auth-app; host-scoped so it is shared across the fleet's
// localhost ports in dev.
const AT_COOKIE = 'r10c_at';
const SIGNIN_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * Protected-app gate, now also the locale gate.
 *
 * Locale resolves first. An unprefixed URL is bounced to its prefixed form
 * before anything else runs — there is nothing worth authorizing about a URL
 * the visitor is not going to stay on, and doing it the other way round would
 * send them to sign-in and back to a URL that redirects again.
 *
 * Presence of the access cookie is the fast edge check, and that is all it is.
 * Two other layers do the work that matters: the back-office layout filters
 * navigation to what the caller's roles grant, and marketplace-admin-service
 * verifies the token's signature and applies `requirePermission` to every
 * catalog route. A forged cookie earns you a page shell and a wall of 401s.
 *
 * The matcher covers the whole app rather than just `/account` — the catalog is
 * no longer public. Two paths stay exempt: `/api/config`, which the browser
 * adapters read to discover the service URL before any session exists, and
 * `/api/health`, which has to answer a cold readiness probe (a redirect to an
 * auth-app that is not running would hang every e2e run before it starts).
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  if (locale.redirect) return locale.redirect;

  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;
  if (!authenticated) {
    const signin = new URL('/', SIGNIN_URL);
    // An ABSOLUTE url, because auth-app has account routes of its own now and a
    // bare `/account` would be ambiguous between the two apps. The path stays
    // unprefixed: auth-app negotiates the locale itself on the way back, so a
    // visitor reading English does not return to Spanish.
    signin.searchParams.set(
      'redirect',
      new URL(locale.pathname, request.nextUrl.origin).toString(),
    );
    const response = NextResponse.redirect(signin);
    rememberLocale(response, locale.locale);
    return response;
  }

  // Root has nothing of its own to show — send an authenticated visitor
  // straight to the dashboard rather than the placeholder root page.
  if (locale.pathname === '/') {
    const target = request.nextUrl.clone();
    target.pathname = localeHref(locale.locale, '/home');
    const response = NextResponse.redirect(target);
    rememberLocale(response, locale.locale);
    return response;
  }

  return rewriteToLocale(request, locale);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/config|api/health|favicon.ico).*)',
  ],
};
