import { cookies } from 'next/headers';

/** Opaque session id — the revocation handle + refresh source. */
export const SID_COOKIE = 'r10c_sid';
/** Short-lived signed access token the services verify. */
export const AT_COOKIE = 'r10c_at';

/** auth-service (:3102), reached server-side from the route handlers. */
export const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL ?? 'http://localhost:3102';

/** Where a successful sign-in/up lands by default (marketplace-admin-app). */
export const DEFAULT_REDIRECT =
  process.env.AUTH_DEFAULT_REDIRECT ?? 'http://localhost:3001';

/** Session cookie lifetime (7 days) — matches the Redis session TTL. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

/** The JSON auth-service returns from register/login. */
export interface AuthResult {
  readonly accessToken: string;
  readonly sessionId: string;
  readonly expiresIn: number;
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // Host-scoped in dev (localhost shares across ports); Secure in production.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

/** Persist the access + session ids as httpOnly cookies on the app's origin. */
export async function setSessionCookies(result: AuthResult): Promise<void> {
  const store = await cookies();
  store.set(AT_COOKIE, result.accessToken, cookieOptions(result.expiresIn));
  store.set(SID_COOKIE, result.sessionId, cookieOptions(SESSION_MAX_AGE));
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
