import { cookies } from 'next/headers';

import { AT_COOKIE, AUTH_SERVICE_URL } from './session';

/** The verified caller, as auth-service's `/api/me` returns it. */
export interface Principal {
  readonly userId: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * Resolve the signed-in principal **server-side**, forwarding the httpOnly
 * access cookie to auth-service as a bearer token. `null` means the token was
 * missing, expired or rejected.
 *
 * The app never decodes the token itself: verification needs `jwt.secret`,
 * which lives in config-service and has no business being copied into the Next
 * runtime just so a layout can read a role.
 */
export async function loadPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (token === undefined) {
    return null;
  }
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as Principal) : null;
  } catch {
    return null;
  }
}

/** Forward the access cookie as a bearer header, for a proxy route handler. */
export async function authorizationHeader(): Promise<HeadersInit> {
  const token = (await cookies()).get(AT_COOKIE)?.value;
  return token === undefined ? {} : { Authorization: `Bearer ${token}` };
}
