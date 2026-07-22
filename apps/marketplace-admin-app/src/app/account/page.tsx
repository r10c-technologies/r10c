import { cookies } from 'next/headers';

import { AccountView, type Principal } from './account-view';

const AT_COOKIE = 'r10c_at';
const ADMIN_SERVICE_URL =
  process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101';

/**
 * Reach the token-verified backend route from the server, forwarding the
 * httpOnly access cookie as a bearer token. A `null` result means the token was
 * missing, expired or rejected by the service.
 */
async function loadPrincipal(): Promise<Principal | null> {
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (token === undefined) {
    return null;
  }
  try {
    const res = await fetch(`${ADMIN_SERVICE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as Principal) : null;
  } catch {
    return null;
  }
}

/**
 * The protected account page: proves the whole loop — this page is only
 * reachable past the middleware gate, and the identity it shows was verified by
 * marketplace-admin-service from the access token, not by the app. Rendering is
 * delegated to a client view so no design-system control is imported server-side.
 */
export default async function AccountPage() {
  const principal = await loadPrincipal();
  return <AccountView principal={principal} />;
}
