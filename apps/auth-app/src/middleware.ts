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
 * Locale first, then two edge-only cookie checks — both fast paths rather than
 * decisions:
 *
 * - the auth surface (`/`, `/signup`) bounces an already-authenticated visitor
 *   to the app;
 * - the back-office (`/users`) bounces anyone with no cookie back to sign-in,
 *   carrying where they were headed.
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
  // read `/es/users` and miss the branch entirely.
  if (locale.pathname.startsWith('/users')) {
    if (!authenticated) {
      const signin = new URL(`/${locale.locale}`, request.nextUrl.origin);
      signin.searchParams.set('redirect', locale.pathname);
      const response = NextResponse.redirect(signin);
      rememberLocale(response, locale.locale);
      return response;
    }
    return rewriteToLocale(request, locale);
  }

  if (authenticated) {
    const response = NextResponse.redirect(DEFAULT_REDIRECT);
    rememberLocale(response, locale.locale);
    return response;
  }
  return rewriteToLocale(request, locale);
}

/**
 * A regex rather than the old literal list (`['/', '/signup', '/users/:path*']`):
 * every one of those paths now also exists under a locale prefix, which the
 * literal form would miss — leaving `/es/users` completely ungated.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api|favicon.ico).*)',
  ],
};
