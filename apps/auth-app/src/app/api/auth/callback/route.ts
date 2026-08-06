import {
  applyDeviceCookie,
  readDeviceContext,
} from '@r10c/shells-next-common/server';
import { type NextRequest, NextResponse } from 'next/server';

import { safeRedirect } from '../../../../lib/redirect';
import { AUTH_SERVICE_URL, setSessionCookies } from '../../../../lib/session';

/**
 * `GET /api/auth/callback` — where Zitadel sends the browser back.
 *
 * This is the registered redirect URI, and it is an **app** route rather than a
 * service one because cookies belong to this origin: auth-service answers JSON
 * and has never known what a cookie is. The handler forwards the code and state,
 * turns the result into httpOnly cookies, and sends the visitor on.
 *
 * The device context is parsed here for the same reason — this is the
 * browser-facing edge, so `next/server`'s `userAgent()` lives on this side and
 * auth-service receives a plain struct.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = request.nextUrl.origin;
  const code = params.get('code');
  const state = params.get('state');

  // The provider refused, or the visitor cancelled. Both come back here as an
  // `error` parameter, and neither is an exception — it is a person choosing not
  // to sign in.
  const providerError = params.get('error');
  if (providerError !== null || code === null || state === null) {
    const failed = new URL('/', origin);
    failed.searchParams.set('error', providerError ?? 'invalidRequest');
    return NextResponse.redirect(failed);
  }

  const { device, issued } = readDeviceContext(request);

  // `.catch` for the same reason as in the start route: a service that is down
  // makes `fetch` throw, and a 500 here would strand a visitor mid-sign-in with
  // no way back to the page that could explain it.
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/oidc/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, state, device }),
    cache: 'no-store',
  }).catch(() => undefined);

  if (res === undefined) {
    const failed = new URL('/', origin);
    failed.searchParams.set('error', 'providerUnavailable');
    return NextResponse.redirect(failed);
  }

  const data = await res.json();

  if (!res.ok) {
    const failed = new URL('/', origin);
    failed.searchParams.set('error', data.code ?? 'unexpected');
    return NextResponse.redirect(failed);
  }

  await setSessionCookies(data);

  // Re-validated even though this app is what stored it: it crossed a third
  // party's redirect in between, and a sign-in that forwards anywhere it is
  // told is an open redirect wearing our domain's credibility. An absent or
  // rejected value falls back to `DEFAULT_REDIRECT` inside the helper.
  const response = NextResponse.redirect(
    new URL(safeRedirect(data.redirect, origin), origin),
  );
  return issued ? applyDeviceCookie(response, device.deviceId) : response;
}
