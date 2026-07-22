import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';

/**
 * Fixed session/token policy for the v1 auth layer. Durations are constants
 * here rather than config so the first cut stays simple; they can move to
 * config-service later without touching call sites.
 */

/** How long a Redis session lives without renewal (7 days). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Access-token lifetime — short, so revocation lag is bounded (15 min). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 15;

/** `iss`/`aud` claims — the shared values every verifier checks against. */
export const JWT_ISSUER = AUTH_TOKEN_ISSUER;
export const JWT_AUDIENCE = AUTH_TOKEN_AUDIENCE;

/** Password given to the seeded dev users so local login works out of the box. */
export const DEV_SEED_PASSWORD = 'password123';
