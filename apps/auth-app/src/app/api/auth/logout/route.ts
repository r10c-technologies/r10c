import { NextResponse } from 'next/server';

import {
  AUTH_SERVICE_URL,
  clearSessionCookies,
  readSessionId,
} from '../../../../lib/session';

/**
 * Server-side logout: revoke the session at auth-service (so every service sees
 * it gone), clear the cookies, and hand back where to go so the **provider's**
 * session ends too.
 *
 * That last part is not decoration. Clearing our cookies alone leaves someone
 * "signed out" who is one click from being signed straight back in with no
 * prompt, because Zitadel still considers them authenticated — which on a
 * shared machine is the whole failure this endpoint exists to prevent. The
 * browser must perform that navigation itself, so the URL is returned rather
 * than followed here.
 *
 * Best-effort on the revoke: the cookies are cleared regardless, so a provider
 * or service outage never leaves a browser holding a session it cannot end.
 */
export async function POST() {
  const sessionId = await readSessionId();
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

  await clearSessionCookies();
  return NextResponse.json({ ok: true, endSessionUrl });
}
