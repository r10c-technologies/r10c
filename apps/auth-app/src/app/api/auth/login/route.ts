import {
  applyDeviceCookie,
  readDeviceContext,
} from '@r10c/shells-next-common/server';
import { type NextRequest, NextResponse } from 'next/server';

import { safeRedirect } from '../../../../lib/redirect';
import { AUTH_SERVICE_URL, setSessionCookies } from '../../../../lib/session';

/**
 * Server-side login: forwards credentials to auth-service, and on success turns
 * the returned tokens into httpOnly cookies on this app's origin. The browser
 * never sees the token — it only learns where to go next.
 *
 * The device context is read and parsed here rather than in auth-service, for
 * the same reason cookies are: this is the browser-facing edge. auth-service
 * stays free of `next/*` and receives a plain struct in the body.
 *
 * `redirect` carries the visitor back to whatever they were denied before
 * signing in, and is validated against the allowlist rather than trusted: a
 * sign-in page that forwards anywhere it is told is an open redirect wearing
 * our domain's credibility.
 */
export async function POST(request: NextRequest) {
  const { redirect, ...credentials } = await request.json();
  const { device, issued } = readDeviceContext(request);

  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...credentials, device }),
    cache: 'no-store',
  });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  await setSessionCookies(data);
  const response = NextResponse.json({
    ok: true,
    redirect: safeRedirect(redirect, new URL(request.url).origin),
  });
  return issued ? applyDeviceCookie(response, device.deviceId) : response;
}
