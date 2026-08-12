import { localeHref } from '@r10c/entifix-ts-i18n/routing';
import {
  rememberLocale,
  resolveLocale,
  rewriteToLocale,
} from '@r10c/shells-next-i18n';
import { type NextRequest, NextResponse } from 'next/server';

// Inlined rather than imported from the auth shell's `/server`, so this
// edge-runtime module never pulls in `next/headers`.
const AT_COOKIE = 'r10c_at';

/**
 * Paths that only make sense while signed **out**. An authenticated visitor
 * landing here is sent on to the dashboard instead.
 *
 * Just the front door. Sign-up and recovery are screens at the provider, so
 * there is nothing else of ours a signed-in visitor could wander into — which
 * is why the blanket "everything needs a session" rule the admin app used is
 * simply this list's complement.
 */
const SIGNED_OUT_ONLY = ['/'];

const matches = (pathname: string, routes: readonly string[]): boolean =>
  routes.some(
    route =>
      pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)),
  );

/**
 * Locale first, then a cookie-presence check per path class.
 *
 * Locale resolves first because there is nothing worth authorizing about a URL
 * the visitor is not going to stay on; doing it the other way round sends them
 * to sign-in and back to a URL that redirects again.
 *
 * Presence of the access cookie is the fast edge check, and that is all it is.
 * Two other layers do the work that matters: the back-office layout filters
 * navigation to what the caller's roles grant, and the services verify the
 * token's signature and apply `requirePermission` to every route. A forged
 * cookie earns you a page shell and a wall of 401s.
 *
 * Both apps' gates are folded together here. What used to be a cross-origin
 * bounce to auth-app on `:3002` is now a redirect to this host's own `/`, so a
 * refused visitor never leaves the origin that holds their cookies.
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  if (locale.redirect) return locale.redirect;

  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;
  // The locale-stripped path — matching on `request.nextUrl.pathname` would
  // read `/es/users` and miss every branch.
  const pathname = locale.pathname;
  const signedOutOnly = matches(pathname, SIGNED_OUT_ONLY);

  if (!authenticated) {
    if (signedOutOnly) return rewriteToLocale(request, locale);

    // A path relative to this origin: sign-in is served here now, so the
    // absolute URL the admin app used to build (to disambiguate two apps'
    // `/account` routes) no longer has two apps to disambiguate.
    const signin = new URL(`/${locale.locale}`, request.nextUrl.origin);
    signin.searchParams.set('redirect', pathname);
    const response = NextResponse.redirect(signin);
    rememberLocale(response, locale.locale);
    return response;
  }

  // Signed in with nothing to show at the front door: go to the dashboard
  // rather than the sign-in card.
  if (signedOutOnly) {
    const target = request.nextUrl.clone();
    target.pathname = localeHref(locale.locale, '/home');
    const response = NextResponse.redirect(target);
    rememberLocale(response, locale.locale);
    return response;
  }

  return rewriteToLocale(request, locale);
}

/**
 * A regex rather than a literal list: every one of these paths also exists under
 * a locale prefix, which a literal form would miss — leaving `/es/users`
 * completely ungated.
 *
 * `api` is excluded wholesale. The route handlers are not protected by this
 * cookie check in any case — they forward the caller's token and the services
 * refuse the request — and `/api/auth/callback` in particular *must* be
 * reachable without a session, since it is where a visitor arrives to get one.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
