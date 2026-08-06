import type { TokenClaims, TokenService } from '@r10c/entifix-ts-business';
import { EntifixBuildError, EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import {
  type CryptoKey,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
} from 'jose';

/** The one algorithm this service signs and accepts. See {@link verifyAccessToken}. */
export const TOKEN_ALGORITHM = 'RS256';

/**
 * Settings for signing and verifying access tokens.
 *
 * Asymmetric on purpose. The verification half travels to every service — and,
 * once buyers can sign in, to the public storefront — so it must be material
 * that cannot mint a token. A shared secret would have put the *signing* key in
 * the least privileged, highest traffic app in the fleet, where a compromise
 * mints `super-admin`.
 */
export interface JoseTokenServiceOptions {
  /** Public key, SPKI PEM. Always required — every holder at least verifies. */
  readonly publicKeyPem: string;
  /**
   * Private key, PKCS#8 PEM. Only the service that mints tokens holds one; an
   * instance without it verifies and refuses to sign.
   */
  readonly privateKeyPem?: string;
  /**
   * The `kid` header stamped on every signed token, and the name of the key a
   * JWKS publishes it under. Rotation is two keys sharing a verifier for a
   * while, which is only expressible if tokens say which key signed them.
   */
  readonly keyId: string;
  /** `iss` claim set on sign and required on verify. */
  readonly issuer: string;
  /** `aud` claim set on sign and required on verify. */
  readonly audience: string;
}

/**
 * Import a PEM once per options object rather than once per token.
 *
 * `importPKCS8`/`importSPKI` are async, but the factory below has to stay
 * synchronously constructible — every composition root builds it inside
 * `Layer.succeed`. Caching the *promise* satisfies both: construction returns
 * immediately, and the parse happens once no matter how many tokens follow.
 */
const privateKeys = new WeakMap<JoseTokenServiceOptions, Promise<CryptoKey>>();
const publicKeys = new WeakMap<JoseTokenServiceOptions, Promise<CryptoKey>>();

const cachedKey = (
  cache: WeakMap<JoseTokenServiceOptions, Promise<CryptoKey>>,
  options: JoseTokenServiceOptions,
  load: () => Promise<CryptoKey>,
): Promise<CryptoKey> => {
  const cached = cache.get(options);
  if (cached !== undefined) {
    return cached;
  }
  const loading = load();
  cache.set(options, loading);
  return loading;
};

/** The private key an options object signs with, or a build error if it has none. */
const signingKey = (options: JoseTokenServiceOptions): Promise<CryptoKey> => {
  const { privateKeyPem } = options;
  if (privateKeyPem === undefined) {
    return Promise.reject(
      new EntifixBuildError(
        'This token service holds no private key and cannot sign — it was configured to verify only',
      ),
    );
  }
  return cachedKey(privateKeys, options, () =>
    importPKCS8(privateKeyPem, TOKEN_ALGORITHM),
  );
};

/** The public key an options object verifies with. Cached apart from the private one. */
const verificationKey = (
  options: JoseTokenServiceOptions,
): Promise<CryptoKey> =>
  cachedKey(publicKeys, options, () =>
    importSPKI(options.publicKeyPem, TOKEN_ALGORITHM),
  );

/**
 * Sign {@link TokenClaims} into a compact JWT that expires after `ttlSeconds`.
 * Exported on its own (not only behind the Effect service) so the same signing
 * path is testable and reusable outside an Effect runtime.
 */
export const signAccessToken = async (
  claims: TokenClaims,
  options: JoseTokenServiceOptions,
  ttlSeconds: number,
): Promise<string> =>
  new SignJWT({ ...claims })
    .setProtectedHeader({ alg: TOKEN_ALGORITHM, kid: options.keyId })
    .setIssuedAt()
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(await signingKey(options));

/**
 * Verify a token's signature, issuer, audience and expiry, returning its
 * claims. A **pure Promise** so it runs anywhere jose does — notably a Next
 * middleware / edge runtime where pulling in the Effect runtime is unwanted.
 * Rejects on any invalid token.
 *
 * `algorithms` is pinned to a single value and that is this file's security
 * boundary: left unset, jose honours the algorithm named in the token's own
 * header, so a caller could present an `HS256` token and have the public key
 * treated as a shared secret. One accepted algorithm makes that unexpressible.
 */
export const verifyAccessToken = async (
  token: string,
  options: JoseTokenServiceOptions,
): Promise<TokenClaims> => {
  const { payload } = await jwtVerify(token, await verificationKey(options), {
    algorithms: [TOKEN_ALGORITHM],
    issuer: options.issuer,
    audience: options.audience,
  });
  return payload as unknown as TokenClaims;
};

/**
 * A `jose`-backed {@link TokenService}. The perimeter provides it with both keys
 * to mint access tokens from a resolved session; every downstream service
 * provides it with the public key alone to verify them. Signing failures are
 * infrastructure errors; a verification failure is the caller presenting a bad
 * token — an {@link EntifixBuildError}, which the perimeter collapses to `401`.
 */
export const makeJoseTokenService = (
  options: JoseTokenServiceOptions,
): TokenService => ({
  sign: (claims, ttlSeconds) =>
    Effect.tryPromise({
      try: () => signAccessToken(claims, options, ttlSeconds),
      // A missing private key is a misconfiguration, not a connectivity
      // problem, and it must not be reported as one: it surfaces as the build
      // error it already is rather than being wrapped into a retryable shape.
      catch: error =>
        error instanceof EntifixBuildError
          ? error
          : new EntifixConnError('Access token signing failed', error),
    }),
  verify: token =>
    Effect.tryPromise({
      try: () => verifyAccessToken(token, options),
      catch: error =>
        new EntifixBuildError('Access token verification failed', error),
    }),
});
