import { type NextRequest, NextResponse } from 'next/server';

// Inlined (not imported from lib/session) so this edge-runtime module never
// pulls in `next/headers`, which is server-only.
const AT_COOKIE = 'r10c_at';
const DEFAULT_REDIRECT =
  process.env.AUTH_DEFAULT_REDIRECT ?? 'http://localhost:3001';

/**
 * Keep an already-authenticated visitor out of the auth surface: if the access
 * cookie is present, bounce `/` and `/signup` to the app. A presence check is
 * enough here — a stale token just means the app redirects back, and the app's
 * own gate + the services do the real verification.
 */
export function middleware(request: NextRequest) {
  const authenticated = request.cookies.get(AT_COOKIE) !== undefined;
  if (authenticated) {
    return NextResponse.redirect(DEFAULT_REDIRECT);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/signup'],
};
