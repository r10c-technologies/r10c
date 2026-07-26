import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../../../lib/principal';
import { AUTH_SERVICE_URL, clearSessionCookies } from '../../../../../lib/session';

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 *
 * auth-service owns the ownership check; this handler only adds the part that
 * has to happen on this origin: if you ended the session you are currently
 * using, the cookies for it are now worthless and must go, or the middleware
 * keeps waving through a browser that has no session left.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE', headers: await authorizationHeader(), cache: 'no-store' },
  );
  const data = await res.json();

  if (res.ok && data.signedOut === true) {
    await clearSessionCookies();
  }
  return NextResponse.json(data, { status: res.status });
}
