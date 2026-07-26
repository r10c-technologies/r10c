import { type NextRequest, NextResponse } from 'next/server';

import {
  applySessionCookies,
  clearSessionCookies,
  SID_COOKIE,
} from './cookies.js';

/** The subset of auth-service's refresh response this handler needs. */
interface RefreshPayload {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly sessionExpiresIn: number;
}

export interface RefreshRouteOptions {
  /** auth-service base URL; defaults to `AUTH_SERVICE_URL` then :3102. */
  readonly authServiceUrl?: string;
}

/**
 * In-flight refreshes, keyed by session id.
 *
 * Several tabs and a lazy server-side refresh can all notice an expiring token
 * within the same second. Collapsing them costs one map and saves the round
 * trips. It is deliberately per-process and not the Redis `LockService`: session
 * ids do not rotate, so the worst a lost race can do is mint a second, equally
 * valid token — a wasted signature, not a correctness problem.
 */
const inFlight = new Map<string, Promise<Response>>();

const refreshOnce = (
  authServiceUrl: string,
  sessionId: string,
): Promise<Response> => {
  const existing = inFlight.get(sessionId);
  if (existing !== undefined) return existing;

  const pending = fetch(`${authServiceUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId }),
    cache: 'no-store',
  }).finally(() => {
    inFlight.delete(sessionId);
  });

  inFlight.set(sessionId, pending);
  return pending;
};

/**
 * Builds `POST /api/auth/refresh` for an `-app`.
 *
 * Every app needs its own copy of this route because cookies are per-origin: in
 * production each `-app` is a different host and mints its own, and only
 * localhost's shared hostname makes it look otherwise. So the *handler* is
 * shared from here and each app mounts it.
 *
 * A dead session clears the cookies rather than leaving them to rot — otherwise
 * the browser keeps presenting a session id that will never refresh again, and
 * the middleware keeps believing there is a session to protect.
 */
export const createRefreshRoute =
  (options: RefreshRouteOptions = {}) =>
  async (request: NextRequest): Promise<NextResponse> => {
    const authServiceUrl =
      options.authServiceUrl ??
      process.env.AUTH_SERVICE_URL ??
      'http://localhost:3102';

    const sessionId = request.cookies.get(SID_COOKIE)?.value;
    if (sessionId === undefined) {
      return NextResponse.json(
        { error: 'no session', code: 'unauthenticated' },
        { status: 401 },
      );
    }

    const upstream = await refreshOnce(authServiceUrl, sessionId).catch(
      () => undefined,
    );
    if (upstream === undefined) {
      // The service is unreachable. The session may well still be fine, so the
      // cookies stay and the client is told to retry rather than sign out.
      return NextResponse.json(
        { error: 'auth service unreachable', code: 'network' },
        { status: 503 },
      );
    }

    // `clone()` because a collapsed refresh hands the same Response to every
    // waiter, and a body can only be read once.
    const data = await upstream.clone().json();

    if (!upstream.ok) {
      return clearSessionCookies(
        NextResponse.json(data, { status: upstream.status }),
      );
    }

    const payload = data as RefreshPayload;
    return applySessionCookies(
      NextResponse.json({
        ok: true,
        expiresIn: payload.expiresIn,
        sessionExpiresIn: payload.sessionExpiresIn,
      }),
      { accessToken: payload.accessToken, sessionExpiresIn: payload.sessionExpiresIn },
    );
  };
