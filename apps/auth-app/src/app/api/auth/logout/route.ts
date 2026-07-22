import { NextResponse } from 'next/server';

import {
  AUTH_SERVICE_URL,
  clearSessionCookies,
  readSessionId,
} from '../../../../lib/session';

/**
 * Server-side logout: revoke the session at auth-service (so every service sees
 * it gone) and clear the cookies. Best-effort on the revoke — the cookies are
 * cleared regardless so the browser is logged out either way.
 */
export async function POST() {
  const sessionId = await readSessionId();
  if (sessionId !== undefined) {
    await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  await clearSessionCookies();
  return NextResponse.json({ ok: true });
}
