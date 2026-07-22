import { NextResponse } from 'next/server';

import {
  AUTH_SERVICE_URL,
  DEFAULT_REDIRECT,
  setSessionCookies,
} from '../../../../lib/session';

/**
 * Server-side login: forwards credentials to auth-service, and on success turns
 * the returned tokens into httpOnly cookies on this app's origin. The browser
 * never sees the token — it only learns where to go next.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  await setSessionCookies(data);
  return NextResponse.json({ ok: true, redirect: DEFAULT_REDIRECT });
}
