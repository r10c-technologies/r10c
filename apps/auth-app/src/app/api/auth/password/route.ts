import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../../lib/principal';
import { AUTH_SERVICE_URL } from '../../../../lib/session';

/**
 * `POST /api/auth/password` — change the signed-in user's password.
 *
 * A same-origin proxy: the httpOnly access cookie becomes a bearer header here,
 * so the browser never handles the token and there is no CORS hop. The password
 * itself is only ever in this request body, never in a URL.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/password`, {
    method: 'POST',
    headers: {
      ...(await authorizationHeader()),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
