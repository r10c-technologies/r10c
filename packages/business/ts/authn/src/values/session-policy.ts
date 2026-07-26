/**
 * The one place session and token durations are decided.
 *
 * This lives in `business-ts-authn` (`scope:shared`, framework-free) rather than
 * inside auth-service because both ends need the same numbers: the service mints
 * sessions with them, and every Next app schedules its refresh against them. Two
 * copies of "fifteen minutes" is how a signer and a verifier silently disagree.
 *
 * Tuning the module's behaviour means editing this file and nothing else. The
 * documented next step — not built yet — is for these to become *defaults* that
 * `session.*` rows in config-service override, the same way `jwt.secret` already
 * arrives from there.
 */

/**
 * How long a session survives without being refreshed. Slides on every refresh,
 * so an actively used session keeps renewing this window.
 */
export const SESSION_IDLE_TTL_SECONDS = 60 * 60 * 24;

/**
 * The hard ceiling, stamped at login and never moved. Without it a sliding
 * window renews forever and a stolen session outlives any means of noticing it.
 */
export const SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Access-token lifetime. Short on purpose: it is the bound on how long a
 * revoked session keeps working, because verification is stateless and never
 * consults the store.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;

/**
 * Fraction of the token's life after which the client refreshes (→ 12 min for a
 * 15 min token). Refreshing exactly at expiry races the requests already in
 * flight; the margin is what stops a user seeing a spurious 401.
 */
export const REFRESH_LEAD_RATIO = 0.8;

/**
 * How long the browser goes without pointer/keyboard/visibility activity before
 * it stops refreshing.
 *
 * This is what makes the idle timeout mean anything. A refresh timer that runs
 * purely on a timer keeps a forgotten tab's session alive indefinitely, so
 * "idle" would measure whether a tab is open rather than whether a person is
 * there. Stopping the timer lets the token lapse and the session age out.
 */
export const CLIENT_IDLE_STOP_SECONDS = 60 * 15;

/** How long before the absolute cap the UI warns that re-authentication is due. */
export const SESSION_EXPIRY_WARNING_SECONDS = 60 * 5;

/** The pair of durations a session is created with. */
export interface SessionLifetime {
  /** Sliding window, renewed by {@link SESSION_IDLE_TTL_SECONDS} on refresh. */
  readonly idleTtlSeconds: number;
  /** Ceiling measured from creation; never extended. */
  readonly absoluteTtlSeconds: number;
}

/** The default lifetime every login is opened with. */
export const DEFAULT_SESSION_LIFETIME: SessionLifetime = {
  idleTtlSeconds: SESSION_IDLE_TTL_SECONDS,
  absoluteTtlSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
};

/** When the client should refresh a token that lives `ttlSeconds`. */
export const refreshDelaySeconds = (
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): number => Math.max(1, Math.floor(ttlSeconds * REFRESH_LEAD_RATIO));
