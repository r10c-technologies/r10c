import { type NextRequest, NextResponse } from 'next/server';

import { AUTH_SERVICE_URL } from '../../../../../lib/session';

/**
 * `POST /api/auth/password/forgot` — start recovery.
 *
 * Unauthenticated by design: whoever is asking has lost their password. The
 * reset link is built against THIS app's own origin, so it lands back on the
 * `/reset-password` screen the visitor came from rather than on a hardcoded
 * host.
 *
 * The upstream status is passed through unchanged — it is always `202`, and
 * making it conditional here would reintroduce the enumeration leak the service
 * carefully avoids.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/password/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...body,
      resetUrlBase: new URL(request.url).origin,
    }),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
