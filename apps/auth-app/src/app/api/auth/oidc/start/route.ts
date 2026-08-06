import { type NextRequest, NextResponse } from 'next/server';

import { AUTH_SERVICE_URL } from '../../../../../lib/session';

/**
 * `GET /api/auth/oidc/start` — leave for the hosted login page.
 *
 * A redirect rather than JSON, so a signed-out visitor can be sent here by an
 * ordinary link or by the middleware without any client code running first.
 * auth-service mints the PKCE pair and the `state`; this handler only carries
 * the browser.
 *
 * `redirect` rides along so the visitor lands back where they were refused. It
 * is stored server-side with the pending authorization rather than kept in a
 * query string across the round trip, which is what stops it being rewritten
 * between the two legs — the callback validates it against the allowlist again
 * regardless, because a value that made a round trip through a third party is
 * not ours until it has been checked.
 */
export async function GET(request: NextRequest) {
  const redirect = request.nextUrl.searchParams.get('redirect') ?? undefined;

  // `.catch`, not just an `!ok` check: a service that is down makes `fetch`
  // *throw*, and an uncaught throw here is a 500 on the one page a signed-out
  // visitor sees. An unreachable auth-service has to look like "we could not
  // reach the provider", not like a broken button.
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/oidc/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect }),
    cache: 'no-store',
  }).catch(() => undefined);

  if (res?.ok !== true) {
    const failed = new URL('/', request.nextUrl.origin);
    failed.searchParams.set('error', 'providerUnavailable');
    return NextResponse.redirect(failed);
  }

  const { authorizationUrl } = await res.json();
  return NextResponse.redirect(authorizationUrl);
}
