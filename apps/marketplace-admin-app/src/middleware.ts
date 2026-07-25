import { type NextRequest, NextResponse } from 'next/server';

// Access cookie set by auth-app; host-scoped so it is shared across the fleet's
// localhost ports in dev.
const AT_COOKIE = 'r10c_at';
const SIGNIN_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * Protected-app gate. A page without the access cookie is bounced to auth-app's
 * sign-in, carrying the original path as `redirect`.
 *
 * Presence is the fast edge check, and that is all it is. Two other layers do
 * the work that matters: the back-office layout filters navigation to what the
 * caller's roles grant, and marketplace-admin-service verifies the token's
 * signature and applies `requirePermission` to every catalog route. A forged
 * cookie earns you a page shell and a wall of 401s.
 *
 * The matcher now covers the whole app rather than just `/account` — the
 * catalog is no longer public. Two paths stay exempt: `/api/config`, which the
 * browser adapters read to discover the service URL before any session exists,
 * and `/api/health`, which has to answer a cold readiness probe (a redirect to
 * an auth-app that is not running would hang every e2e run before it starts).
 */
export function middleware(request: NextRequest) {
  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;
  if (!authenticated) {
    const signin = new URL('/', SIGNIN_URL);
    signin.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(signin);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|api/config|api/health|favicon.ico).*)',
  ],
};
