import { unverifiedRoles } from '@r10c/entifix-ts-jwt-client';
import { cookies } from 'next/headers';

/** The access cookie this host sets at the end of the OIDC callback. */
const AT_COOKIE = 'r10c_at';

/**
 * The caller's roles, read straight out of the access cookie **without
 * verifying its signature** — see `unverifiedRoles`.
 *
 * That is deliberate and it is safe *for this use*: the only thing these roles
 * decide here is which navigation entries render. Forging the cookie would show
 * someone a menu; every route behind it still goes to
 * marketplace-admin-service, which verifies the token properly and answers 401
 * or 403. The alternatives were worse — calling a service on every server render
 * just to shape a menu, or copying `jwt.secret` out of config-service into the
 * Next runtime.
 *
 * Never branch on this for access.
 */
export async function navRoles(): Promise<readonly string[]> {
  return unverifiedRoles((await cookies()).get(AT_COOKIE)?.value);
}
