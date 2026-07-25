import type { TokenClaims } from '@r10c/entifix-ts-business';

/**
 * Base64url → JSON. `atob` + `TextDecoder` rather than `Buffer` so the same
 * function runs in Node, the browser and the edge runtime unchanged.
 */
const decodeSegment = (segment: string): unknown => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

/**
 * Read a token's claims **without checking its signature**.
 *
 * ⚠️ This proves nothing. A caller can forge any claims it likes. Use it only
 * for presentation — deciding which nav entries to render, say — where being
 * wrong costs a menu item and every request behind that item is still refused
 * by the service's `requirePermission`. Never branch on it for access.
 *
 * It exists so a Next server component can shape a menu without either calling
 * a service on every render or copying `jwt.secret` out of config-service into
 * the app runtime. Anything that must be *true* goes to
 * {@link verifyAccessToken} or to the owning service.
 *
 * Returns `undefined` for anything that is not a well-formed JWT payload.
 */
export const unverifiedClaims = (token: string): TokenClaims | undefined => {
  const [, payloadSegment, signature] = token.split('.');
  if (payloadSegment === undefined || signature === undefined) {
    return undefined;
  }
  try {
    const payload = decodeSegment(payloadSegment);
    return typeof payload === 'object' && payload !== null
      ? (payload as TokenClaims)
      : undefined;
  } catch {
    return undefined;
  }
};

/** The roles claim, or an empty list. Same warning as {@link unverifiedClaims}. */
export const unverifiedRoles = (
  token: string | undefined,
): readonly string[] => {
  if (token === undefined) {
    return [];
  }
  const roles = unverifiedClaims(token)?.roles;
  return Array.isArray(roles) ? roles : [];
};
