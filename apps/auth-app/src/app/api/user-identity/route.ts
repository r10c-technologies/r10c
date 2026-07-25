import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../lib/principal';
import { AUTH_SERVICE_URL } from '../../../lib/session';

/**
 * Proxy the user collection through this app's own origin, forwarding the
 * httpOnly access cookie as a bearer token. Same reason the credential routes
 * do it: the browser never holds the token, and no cross-origin request means
 * no CORS. auth-service still applies `requirePermission`, so a 403 here is the
 * real decision, not a courtesy.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).search;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity${query}`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** Create a user. The role, if any, is vetted against the caller's tier upstream. */
export async function POST(request: Request) {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authorizationHeader()),
    },
    body: JSON.stringify(await request.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
