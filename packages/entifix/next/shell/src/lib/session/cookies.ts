import type { NextResponse } from 'next/server';

/** Short-lived signed access token the services verify. */
export const AT_COOKIE = 'r10c_at';
/** Opaque session id — the revocation handle and the refresh source. */
export const SID_COOKIE = 'r10c_sid';

/** What auth-service hands back from login / register / refresh. */
export interface SessionCookiePayload {
  readonly accessToken: string;
  /** Absent on a refresh: the session id does not change. */
  readonly sessionId?: string;
  /** Seconds until the session's absolute ceiling — both cookies are sized to it. */
  readonly sessionExpiresIn: number;
}

/**
 * Both cookies outlive the access token on purpose.
 *
 * Sizing `r10c_at` to the token's own 15 minutes is what used to sign everyone
 * out four times an hour: once the cookie vanished, the middleware's presence
 * check could no longer tell "your token needs refreshing" from "you were never
 * signed in", and chose the second. The JWT's `exp` is the real authority on
 * whether a token is usable; the cookie only has to survive long enough for the
 * refresh path to notice.
 */
const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Host-scoped in dev (localhost shares cookies across ports); Secure in production.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

/** Write the session cookies onto an outgoing response. */
export const applySessionCookies = (
  response: NextResponse,
  payload: SessionCookiePayload,
): NextResponse => {
  const maxAge = payload.sessionExpiresIn;
  response.cookies.set(AT_COOKIE, payload.accessToken, cookieOptions(maxAge));
  if (payload.sessionId !== undefined) {
    response.cookies.set(SID_COOKIE, payload.sessionId, cookieOptions(maxAge));
  }
  return response;
};

/** Clear both cookies on an outgoing response (sign-out, dead session). */
export const clearSessionCookies = (response: NextResponse): NextResponse => {
  response.cookies.delete(AT_COOKIE);
  response.cookies.delete(SID_COOKIE);
  return response;
};
