import { ACCESS_COOKIE } from '@entifix/core';
import { unverifiedClaims } from '@entifix/jwt';
import { cookies } from 'next/headers';

/**
 * What the navigation filter needs to know about the caller.
 *
 * Two independent ceilings, and they are read together because a nav item can
 * be subject to both: what the person's roles grant, and what their
 * organization is provisioned for.
 */
export interface NavPrincipal {
  readonly roles: readonly string[];
  /**
   * The organization the session acts for, if any. This is what decides whether
   * {@link NavPrincipal.entitlements} is consulted at all — an operator or a
   * buyer holds no tenant scope, so the entitlement ceiling does not apply to
   * them rather than denying them everything.
   */
  readonly organizationId?: string;
  /** The domains that organization is provisioned for. Empty when it has none. */
  readonly entitlements: readonly string[];
}

/**
 * The caller's roles, organization and entitlements, read straight out of the
 * access cookie **without verifying its signature** — see `unverifiedClaims`.
 *
 * That is deliberate and it is safe *for this use*: the only thing these values
 * decide here is which navigation entries render. Forging the cookie would show
 * someone a menu; every route behind it still goes to
 * marketplace-admin-service, which verifies the token properly and answers 401
 * or 403. The alternatives were worse — calling a service on every server render
 * just to shape a menu, or copying the signing key out of config-service into
 * the Next runtime.
 *
 * Never branch on this for access.
 */
export async function navPrincipal(): Promise<NavPrincipal> {
  const claims = unverifiedClaims(
    (await cookies()).get(ACCESS_COOKIE)?.value ?? '',
  );
  const organizationId = claims?.activeOrganizationId;
  const entitlements = claims?.entitlements;

  return {
    roles: Array.isArray(claims?.roles) ? claims.roles : [],
    ...(typeof organizationId === 'string' ? { organizationId } : {}),
    entitlements: Array.isArray(entitlements) ? entitlements : [],
  };
}

/**
 * Seconds left on the access cookie this page is rendered with, from its `exp`
 * — **unverified**, for the same reason as {@link navPrincipal}, and safe for
 * the same reason: it decides only when the browser next asks for a refresh.
 * A forged `exp` makes a tab refresh early or late; the refresh route and every
 * service behind it still verify the token they are actually handed.
 *
 * `undefined` when there is no cookie or no `exp`, and the keepalive falls back
 * to its default schedule.
 */
export async function accessTokenExpiresIn(): Promise<number | undefined> {
  const claims = unverifiedClaims(
    (await cookies()).get(ACCESS_COOKIE)?.value ?? '',
  ) as { readonly exp?: unknown } | undefined;
  const exp = claims?.exp;
  return typeof exp === 'number'
    ? Math.max(0, Math.floor(exp - Date.now() / 1000))
    : undefined;
}
