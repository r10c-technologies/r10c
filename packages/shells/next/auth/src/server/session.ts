import { SESSION_ABSOLUTE_TTL_SECONDS } from '@r10c/business-ts-authn';
import { cookies } from 'next/headers';

/** Opaque session id — the revocation handle + refresh source. */
export const SID_COOKIE = 'r10c_sid';
/** Short-lived signed access token the services verify. */
export const AT_COOKIE = 'r10c_at';

/** auth-service (:3102), reached server-side from the route handlers. */
export const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://localhost:3102';

/** Where a successful sign-in lands by default (the back office itself). */
export const DEFAULT_REDIRECT =
  process.env.AUTH_DEFAULT_REDIRECT ?? 'http://localhost:3001';

/**
 * Fallback session cookie lifetime, used only if auth-service answers without
 * `sessionExpiresIn`. Matches the absolute ceiling in `session-policy.ts`.
 */
const SESSION_MAX_AGE = SESSION_ABSOLUTE_TTL_SECONDS;

/** The JSON auth-service returns from register/login. */
export interface AuthResult {
  readonly accessToken: string;
  readonly sessionId: string;
  /** Access-token lifetime. NOT the cookie lifetime — see below. */
  readonly expiresIn: number;
  /** Seconds until the session's absolute ceiling. */
  readonly sessionExpiresIn?: number;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Host-scoped in dev (localhost shares across ports); Secure in production.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

/**
 * Persist the access + session ids as httpOnly cookies on the app's origin.
 *
 * Both are sized to the SESSION, not to the access token. Sizing `r10c_at` to
 * `expiresIn` is what signed everyone out every fifteen minutes: when the cookie
 * expired, the middleware's presence check could not tell "this token needs
 * refreshing" from "there is no session", and picked the second — while the
 * Redis session had days left. The JWT's own `exp` remains the authority on
 * whether a token is *usable*; the cookie only has to outlive it long enough for
 * the refresh route to be reached.
 */
export async function setSessionCookies(result: AuthResult): Promise<void> {
  const store = await cookies();
  const maxAge = result.sessionExpiresIn ?? SESSION_MAX_AGE;
  store.set(AT_COOKIE, result.accessToken, cookieOptions(maxAge));
  store.set(SID_COOKIE, result.sessionId, cookieOptions(maxAge));
}

/** Clear both cookies (logout). */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(AT_COOKIE);
  store.delete(SID_COOKIE);
}

/** Read the current session id, if any. */
export async function readSessionId(): Promise<string | undefined> {
  return (await cookies()).get(SID_COOKIE)?.value;
}
