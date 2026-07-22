/**
 * The `iss`/`aud` an access token is minted with and verified against. Shared so
 * the perimeter that signs and every service that verifies agree on one value —
 * a mismatch is a silent `401`, so it must not be duplicated as loose literals.
 */
export const AUTH_TOKEN_ISSUER = 'r10c-auth';
export const AUTH_TOKEN_AUDIENCE = 'r10c-fleet';
