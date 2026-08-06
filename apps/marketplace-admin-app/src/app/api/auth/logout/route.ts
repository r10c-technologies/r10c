import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const SID_COOKIE = 'r10c_sid';
const AT_COOKIE = 'r10c_at';
const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://localhost:3102';
const AUTH_APP_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * Log out from the admin app: revoke the session at auth-service (so every
 * service sees it gone immediately) and clear this app's cookies.
 *
 * `endSessionUrl` is forwarded so the browser can end Zitadel's session too.
 * Without it the visitor is signed out of r10c and still authenticated at the
 * provider — one click from being let back in with no prompt, which is not what
 * anyone means by signing out on a shared machine.
 */
export async function POST() {
  const store = await cookies();
  const sessionId = store.get(SID_COOKIE)?.value;
  let endSessionUrl: string | undefined;

  if (sessionId !== undefined) {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
      cache: 'no-store',
    }).catch(() => undefined);

    if (res?.ok === true) {
      endSessionUrl = (await res.json()).endSessionUrl;
    }
  }
  store.delete(AT_COOKIE);
  store.delete(SID_COOKIE);
  return NextResponse.json({ ok: true, redirect: AUTH_APP_URL, endSessionUrl });
}
