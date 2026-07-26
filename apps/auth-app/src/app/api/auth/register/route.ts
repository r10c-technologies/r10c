import {
  applyDeviceCookie,
  readDeviceContext,
} from '@r10c/shells-next-common/server';
import { type NextRequest, NextResponse } from 'next/server';

import {
  AUTH_SERVICE_URL,
  DEFAULT_REDIRECT,
  setSessionCookies,
} from '../../../../lib/session';

/**
 * Server-side registration: forwards the new-account payload to auth-service,
 * which provisions the account and opens a session in one call, then sets the
 * session cookies so the user is logged straight in.
 *
 * The device is recorded here too, so the browser someone signed up on is the
 * first entry in their device list rather than an unexplained gap.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { device, issued } = readDeviceContext(request);

  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, device }),
    cache: 'no-store',
  });
  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  await setSessionCookies(data);
  const response = NextResponse.json({ ok: true, redirect: DEFAULT_REDIRECT });
  return issued ? applyDeviceCookie(response, device.deviceId) : response;
}
