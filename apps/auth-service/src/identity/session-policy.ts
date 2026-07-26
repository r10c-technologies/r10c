import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';

/**
 * Service-local auth policy.
 *
 * The durations that used to live here now live in `@r10c/business-ts-authn`
 * (`values/session-policy.ts`), because the browser needs the same numbers to
 * schedule its refresh and a second copy is how the two ends drift apart. They
 * are re-exported below so call sites inside this service did not have to move.
 */
export {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_SESSION_LIFETIME,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
} from '@r10c/business-ts-authn';

/** `iss`/`aud` claims — the shared values every verifier checks against. */
export const JWT_ISSUER = AUTH_TOKEN_ISSUER;
export const JWT_AUDIENCE = AUTH_TOKEN_AUDIENCE;

/** Password given to the seeded dev users so local login works out of the box. */
export const DEV_SEED_PASSWORD = 'password123';
