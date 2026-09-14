import type { TokenClaims } from '@r10c/entifix-ts-business';
import { ACCESS_COOKIE } from '@r10c/entifix-ts-core';

/**
 * The principal a stubbed application runs as when nobody configured one.
 *
 * `admin` rather than something narrower, because the point of the stub is to
 * let someone see entifix working before they decide how identity works for
 * them — a stub that hid half the screens would be demonstrating its own
 * restrictions, not the framework.
 */
export const STUB_CLAIMS: TokenClaims = {
  userId: 'stub-user',
  subject: 'stub-user',
  sessionId: 'stub-session',
  roles: ['admin'],
};

const base64url = (value: string): string =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * A structurally valid, **deliberately unsigned** access token for these claims.
 *
 * The same shape `@entifix/testing-e2e`'s `seedSession` fabricates, so the two
 * never disagree about what a seeded session looks like. Only
 * {@link makeFixedTokenService} will accept it; a real `TokenService` rejects
 * the signature, which is the property that keeps a stub out of production.
 */
export const stubAccessToken = (claims: TokenClaims = STUB_CLAIMS): string => {
  const header = base64url(
    JSON.stringify({ alg: 'RS256', kid: 'entifix-stub', typ: 'JWT' }),
  );
  const payload = base64url(
    JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  return `${header}.${payload}.entifix-stub-not-a-signature`;
};

/**
 * The cookie to set so an application sees a signed-in session.
 *
 * ⚠️ **The real cookie, not a bypass.** The stub mints into `entifix_at`, the
 * cookie every entifix reader already looks for, so the middleware's presence
 * check, the Next shell's bearer forwarding and the service shell's
 * `requirePrincipal` all run exactly as they do for a real user. A stub that
 * skipped the cookie path would leave that path proven by nothing but the one
 * application that happens to have an identity provider.
 */
export const stubSessionCookie = (
  claims: TokenClaims = STUB_CLAIMS,
): { readonly name: string; readonly value: string } => ({
  name: ACCESS_COOKIE,
  value: stubAccessToken(claims),
});
