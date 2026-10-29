import {
  PROBLEM_CONTENT_TYPE,
  problemOf,
  Unauthenticated,
} from '@entifix/core';
import { bearerHeader, sessionToken } from '@entifix/next-shell/server';
import { MARKETPLACE_ADMIN_SERVICE_URL } from '@r10c/shells-next-marketplace-admin/server';
import { NextResponse } from 'next/server';

/**
 * Server-side proxy to the token-verified backend route. Reads the httpOnly
 * access cookie (invisible to browser JS) and forwards it as a bearer token to
 * marketplace-admin-service `/api/me`, which verifies the signature and returns
 * the principal. This is the "tokens in backend integration" proof, done
 * same-origin so no CORS is involved.
 */
export async function GET() {
  const token = await sessionToken();
  if (token === undefined) {
    // The same problem body a service answers a missing session with.
    return NextResponse.json(
      problemOf(new Unauthenticated(), { status: 401 }),
      {
        status: 401,
        headers: { 'content-type': PROBLEM_CONTENT_TYPE },
      },
    );
  }

  const res = await fetch(`${MARKETPLACE_ADMIN_SERVICE_URL}/api/me`, {
    headers: bearerHeader(token),
    cache: 'no-store',
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/json',
    },
  });
}
