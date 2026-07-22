import { NextResponse } from 'next/server';

import {
  AUTH_SERVICE_URL,
  DEFAULT_REDIRECT,
  setSessionCookies,
} from '../../../../lib/session';

/**
 * Server-side registration: forwards the new-account payload to auth-service,
 * which provisions the account and opens a session in one call, then sets the
 * session cookies so the user is logged straight in.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/register`, {
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
