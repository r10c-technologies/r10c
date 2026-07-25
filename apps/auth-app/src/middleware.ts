import { type NextRequest, NextResponse } from 'next/server';

// Inlined (not imported from lib/session) so this edge-runtime module never
// pulls in `next/headers`, which is server-only.
const AT_COOKIE = 'r10c_at';
const DEFAULT_REDIRECT =
  process.env.AUTH_DEFAULT_REDIRECT ?? 'http://localhost:3001';

/**
 * Two edge-only cookie checks, both fast paths rather than decisions:
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
  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;

  if (request.nextUrl.pathname.startsWith('/users')) {
    if (!authenticated) {
      const signin = new URL('/', request.nextUrl.origin);
      signin.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(signin);
    }
    return NextResponse.next();
  }

  if (authenticated) {
    return NextResponse.redirect(DEFAULT_REDIRECT);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/signup', '/users/:path*'],
};
