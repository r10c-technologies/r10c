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

/**
 * How long a started sign-in may sit unfinished.
 *
 * Short on purpose: this is the window in which a stored PKCE verifier and
 * nonce are live, and the only thing that has to fit inside it is a human
 * typing a password and possibly a second factor. Ten minutes is generous for
 * that and short enough that abandoned flows do not accumulate.
 */
export const OIDC_STATE_TTL_SECONDS = 600;

/**
 * Password the seeded dev users are created with **in Zitadel**, so local
 * sign-in works out of the box.
 *
 * It is not a credential this service stores or checks — nothing here can. It
 * is an argument to the provisioning call, and the only copy afterwards lives
 * in the provider.
 *
 * It has to satisfy Zitadel's default complexity policy (8+ characters, upper,
 * lower, digit and symbol) or `createHuman` rejects every seeded user and the
 * whole fleet boots with accounts nobody can sign in as. The old
 * `password123` did not, which is precisely the failure this comment exists to
 * stop someone re-introducing.
 */
export const DEV_SEED_PASSWORD = 'Password123!';
