import type { TokenClaims, TokenService } from '@r10c/entifix-ts-business';
import { EntifixBuildError, EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { jwtVerify, SignJWT } from 'jose';

/** Settings shared by signing and verifying — the same `secret`/`issuer`/`audience`. */
export interface JoseTokenServiceOptions {
  /** Shared secret (HS256). Comes from config-service; never hardcoded. */
  readonly secret: string;
  /** `iss` claim set on sign and required on verify. */
  readonly issuer: string;
  /** `aud` claim set on sign and required on verify. */
  readonly audience: string;
  /** JWS algorithm; defaults to `HS256`. */
  readonly algorithm?: string;
}

const encodeSecret = (secret: string): Uint8Array =>
  new TextEncoder().encode(secret);

/**
 * Sign {@link TokenClaims} into a compact JWT that expires after `ttlSeconds`.
 * Exported on its own (not only behind the Effect service) so the same signing
 * path is testable and reusable outside an Effect runtime.
 */
export const signAccessToken = (
  claims: TokenClaims,
  options: JoseTokenServiceOptions,
  ttlSeconds: number,
): Promise<string> =>
  new SignJWT({ ...claims })
    .setProtectedHeader({ alg: options.algorithm ?? 'HS256' })
    .setIssuedAt()
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encodeSecret(options.secret));

/**
 * Verify a token's signature, issuer, audience and expiry, returning its
 * claims. A **pure Promise** so it runs anywhere jose does — notably a Next
 * middleware / edge runtime where pulling in the Effect runtime is unwanted.
 * Rejects on any invalid token.
 */
export const verifyAccessToken = async (
  token: string,
  options: JoseTokenServiceOptions,
): Promise<TokenClaims> => {
  const { payload } = await jwtVerify(token, encodeSecret(options.secret), {
    issuer: options.issuer,
    audience: options.audience,
  });
  return payload as unknown as TokenClaims;
};

/**
 * A `jose`-backed {@link TokenService}. The perimeter provides it to mint access
 * tokens from a resolved session; every downstream service provides it to
 * verify them. Signing failures are infrastructure errors; a verification
 * failure is the caller presenting a bad token — an {@link EntifixBuildError},
 * which the perimeter collapses to `401`.
 */
export const makeJoseTokenService = (
  options: JoseTokenServiceOptions,
): TokenService => ({
  sign: (claims, ttlSeconds) =>
    Effect.tryPromise({
      try: () => signAccessToken(claims, options, ttlSeconds),
      catch: (error) =>
        new EntifixConnError('Access token signing failed', error),
    }),
  verify: (token) =>
    Effect.tryPromise({
      try: () => verifyAccessToken(token, options),
      catch: (error) =>
        new EntifixBuildError('Access token verification failed', error),
    }),
});
