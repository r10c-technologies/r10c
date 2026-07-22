import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const SID_COOKIE = 'r10c_sid';
const AT_COOKIE = 'r10c_at';
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://localhost:3102';
const AUTH_APP_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * Log out from the admin app: revoke the session at auth-service (so every
 * service sees it gone immediately) and clear this app's cookies. The client
 * then navigates to the sign-in surface.
 */
export async function POST() {
  const store = await cookies();
  const sessionId = store.get(SID_COOKIE)?.value;
  if (sessionId !== undefined) {
    await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  store.delete(AT_COOKIE);
  store.delete(SID_COOKIE);
  return NextResponse.json({ ok: true, redirect: AUTH_APP_URL });
}
