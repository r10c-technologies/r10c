import { NextResponse } from 'next/server';

import { AUTH_SERVICE_URL, clearSessionCookies } from '../../../../../lib/session';

/**
 * `POST /api/auth/password/reset` — redeem a recovery link.
 *
 * Unauthenticated: the point is that the caller could not sign in. On success
 * the service revokes every session, so any cookies this browser still holds
 * are worthless and are cleared here — otherwise the middleware keeps waving
 * through a browser whose session no longer exists.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/password/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();

  if (res.ok) {
    await clearSessionCookies();
  }
  return NextResponse.json(data, { status: res.status });
}
