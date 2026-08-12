import {
  applyDeviceCookie,
  readDeviceContext,
} from '@r10c/shells-next-common/server';
import { type NextRequest, NextResponse } from 'next/server';

import { authorizationHeader } from './principal';
import { safeRedirect } from './redirect';
import {
  AUTH_SERVICE_URL,
  clearSessionCookies,
  readSessionId,
  setSessionCookies,
} from './session';

/**
 * The auth domain's route handlers, as values a host mounts.
 *
 * They live here rather than in the app because the surface is the domain's,
 * not the host's: whichever app carries the browser-facing edge must serve
 * exactly these, and a second host would otherwise copy them. Nothing varies per
 * host — `AUTH_SERVICE_URL` is environment, not composition — so they are ready
 * handlers rather than factories; `createConfigRoute` stays a factory in
 * `shells-next-common` because its `service` name genuinely differs per app.
 *
 * They are exported from `/server` and never from the package's main entry:
 * anything a route handler runs must not be reachable through the client
 * surface, or Next stamps it as a client reference.
 */

/**
 * `GET /api/auth/oidc/start` — leave for the hosted login page.
 *
 * A redirect rather than JSON, so a signed-out visitor can be sent here by an
 * ordinary link or by the middleware without any client code running first.
 * auth-service mints the PKCE pair and the `state`; this handler only carries
 * the browser.
 *
 * `redirect` rides along so the visitor lands back where they were refused. It
 * is stored server-side with the pending authorization rather than kept in a
 * query string across the round trip, which is what stops it being rewritten
 * between the two legs — the callback validates it against the allowlist again
 * regardless, because a value that made a round trip through a third party is
 * not ours until it has been checked.
 */
export async function oidcStartRoute(request: NextRequest) {
  const redirect = request.nextUrl.searchParams.get('redirect') ?? undefined;

  // `.catch`, not just an `!ok` check: a service that is down makes `fetch`
  // *throw*, and an uncaught throw here is a 500 on the one page a signed-out
  // visitor sees. An unreachable auth-service has to look like "we could not
  // reach the provider", not like a broken button.
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/oidc/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect }),
    cache: 'no-store',
  }).catch(() => undefined);

  if (res?.ok !== true) {
    const failed = new URL('/', request.nextUrl.origin);
    failed.searchParams.set('error', 'providerUnavailable');
    return NextResponse.redirect(failed);
  }

  const { authorizationUrl } = await res.json();
  return NextResponse.redirect(authorizationUrl);
}

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
export async function oidcCallbackRoute(request: NextRequest) {
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

/**
 * `POST /api/auth/logout` — revoke the session at auth-service (so every service
 * sees it gone), clear the cookies, and hand back where to go so the
 * **provider's** session ends too.
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
export async function logoutRoute() {
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

/**
 * `GET /api/auth/sessions` — proxy the caller's session list.
 *
 * Same-origin from the browser's point of view, with the httpOnly access cookie
 * turned into a bearer header here. The browser never handles the token, and
 * there is no CORS hop.
 */
export async function sessionListRoute() {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/sessions`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** `POST /api/auth/sessions` — end every session but the caller's own. */
export async function revokeOtherSessionsRoute() {
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/auth/sessions/revoke-others`,
    {
      method: 'POST',
      headers: {
        ...(await authorizationHeader()),
        'content-type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    },
  );
  return NextResponse.json(await res.json(), { status: res.status });
}

/**
 * `DELETE /api/auth/sessions/:sessionId` — end one of the caller's sessions.
 *
 * auth-service owns the ownership check; this handler only adds the part that
 * has to happen on this origin: if you ended the session you are currently
 * using, the cookies for it are now worthless and must go, or the middleware
 * keeps waving through a browser that has no session left.
 */
export async function deleteSessionRoute(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers: await authorizationHeader(),
      cache: 'no-store',
    },
  );
  const data = await res.json();

  if (res.ok && data.signedOut === true) {
    await clearSessionCookies();
  }
  return NextResponse.json(data, { status: res.status });
}

/**
 * Proxy the user collection through this app's own origin, forwarding the
 * httpOnly access cookie as a bearer token. Same reason the credential routes
 * do it: the browser never holds the token, and no cross-origin request means
 * no CORS. auth-service still applies `requirePermission`, so a 403 here is the
 * real decision, not a courtesy.
 */
export async function userListRoute(request: Request) {
  const query = new URL(request.url).search;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity${query}`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/** Create a user. The role, if any, is vetted against the caller's tier upstream. */
export async function createUserRoute(request: Request) {
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authorizationHeader()),
    },
    body: JSON.stringify(await request.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

type IdParams = { params: Promise<{ id: string }> };

/** Read one user, forwarding the access cookie as a bearer token. */
export async function userByIdRoute(_request: Request, { params }: IdParams) {
  const { id } = await params;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity/${id}`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/**
 * Change a user's role or status. auth-service revokes that user's sessions on
 * success, so the change takes effect immediately rather than when their
 * current access token expires.
 */
export async function patchUserRoute(request: Request, { params }: IdParams) {
  const { id } = await params;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(await authorizationHeader()),
    },
    body: JSON.stringify(await request.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/**
 * Administrative session control, proxied same-origin.
 *
 * The permission check lives on auth-service (`authn:user-device:read|write`).
 * These handlers only forward the caller's verified token — they decide nothing,
 * and a caller without the grant gets a 403 from the service, not from here.
 */
const userSessionsUpstream = (id: string) =>
  `${AUTH_SERVICE_URL}/api/user-identity/${encodeURIComponent(id)}/sessions`;

export async function userSessionListRoute(
  _request: Request,
  { params }: IdParams,
) {
  const { id } = await params;
  const res = await fetch(userSessionsUpstream(id), {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function revokeUserSessionsRoute(
  _request: Request,
  { params }: IdParams,
) {
  const { id } = await params;
  const res = await fetch(userSessionsUpstream(id), {
    method: 'DELETE',
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
