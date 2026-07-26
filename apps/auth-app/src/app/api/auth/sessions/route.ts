import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../../lib/principal';
import { AUTH_SERVICE_URL } from '../../../../lib/session';

/**
 * `GET /api/auth/sessions` — proxy the caller's session list.
 *
 * Same-origin from the browser's point of view, with the httpOnly access cookie
 * turned into a bearer header here. The browser never handles the token, and
 * there is no CORS hop.
 */
export async function GET() {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/sessions`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** `POST /api/auth/sessions` — end every session but the caller's own. */
export async function POST() {
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/auth/sessions/revoke-others`,
    {
      method: 'POST',
      headers: { ...(await authorizationHeader()), 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}
