import { type NextRequest, NextResponse } from 'next/server';

// Access cookie set by auth-app; host-scoped so it is shared across the fleet's
// localhost ports in dev.
const AT_COOKIE = 'r10c_at';
const SIGNIN_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * Protected-route gate. A page under the matcher without the access cookie is
 * bounced to auth-app's sign-in, carrying the original path as `redirect`.
 * Presence is the fast edge check; the real token verification happens when the
 * page calls a backend service (which verifies the signature) — see `/account`
 * → `/api/me`.
 *
 * v1 protects the `/account` area only — the demonstration of the mechanism —
 * so the existing (auth-unaware) catalog e2e suite is untouched. Widening the
 * matcher to the whole app is a one-line change here once those specs seed a
 * session; catalog pages stay public until then.
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
  matcher: ['/account/:path*'],
};
