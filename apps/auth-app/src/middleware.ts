import {
  rememberLocale,
  resolveLocale,
  rewriteToLocale,
} from '@r10c/shells-next-i18n';
import { type NextRequest, NextResponse } from 'next/server';

// Inlined (not imported from lib/session) so this edge-runtime module never
// pulls in `next/headers`, which is server-only.
const AT_COOKIE = 'r10c_at';
const DEFAULT_REDIRECT =
  process.env.AUTH_DEFAULT_REDIRECT ?? 'http://localhost:3001';

/**
 * Paths that only make sense while signed OUT. An authenticated visitor landing
 * here is bounced to the app.
 *
 * Just the landing page now. Sign-up and recovery are screens at the provider,
 * so there is nothing of ours left for a signed-in visitor to wander into.
 */
const SIGNED_OUT_ONLY = ['/'];

/** Paths that require a session. */
const SIGNED_IN_ONLY = ['/users', '/account'];

const matches = (pathname: string, routes: readonly string[]): boolean =>
  routes.some(
    route =>
      pathname === route || (route !== '/' && pathname.startsWith(`${route}/`)),
  );

/**
 * Locale first, then a cookie-presence check per path class.
 *
 * This used to bounce an authenticated visitor away from **every** path except
 * `/users`, which made the whole account surface unreachable: arriving at
 * `/account/security` with a valid session sent you straight back to the admin
 * app. The path classes above are what fixed it — "signed in" is only a reason
 * to redirect on the sign-in screen itself.
 *
 * Presence is all that is checked here. The **role** gate lives in the
 * back-office server layout, which resolves the principal from auth-service —
 * verifying the token at the edge would mean copying `jwt.secret` into the Next
 * runtime. And the real boundary is neither of those: auth-service refuses the
 * request itself.
 */
export function middleware(request: NextRequest) {
  const locale = resolveLocale(request);
  if (locale.redirect) return locale.redirect;

  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;
  // The locale-stripped path — matching on `request.nextUrl.pathname` would
  // read `/es/users` and miss every branch.
  const pathname = locale.pathname;

  if (matches(pathname, SIGNED_IN_ONLY)) {
    if (!authenticated) {
      const signin = new URL(`/${locale.locale}`, request.nextUrl.origin);
      signin.searchParams.set('redirect', pathname);
      const response = NextResponse.redirect(signin);
      rememberLocale(response, locale.locale);
      return response;
    }
    return rewriteToLocale(request, locale);
  }

  if (authenticated && matches(pathname, SIGNED_OUT_ONLY)) {
    const response = NextResponse.redirect(DEFAULT_REDIRECT);
    rememberLocale(response, locale.locale);
    return response;
  }

  return rewriteToLocale(request, locale);
}

/**
 * A regex rather than a literal list: every one of these paths also exists under
 * a locale prefix, which a literal form would miss — leaving `/es/users`
 * completely ungated.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|api|favicon.ico).*)'],
};
