import { createHash, randomBytes } from 'node:crypto';

/** A PKCE verifier and the challenge derived from it. */
export interface PkcePair {
  /** Held by the server between the two legs; never leaves it. */
  readonly codeVerifier: string;
  /** Sent to the authorization endpoint, where it is public by design. */
  readonly codeChallenge: string;
}

/** The only challenge method we send. Plain is a downgrade, so it is not offered. */
export const CODE_CHALLENGE_METHOD = 'S256';

/**
 * A fresh PKCE pair.
 *
 * PKCE is what secures a **public** client: the OIDC app is registered without
 * a secret, so possession of the authorization code alone must not be enough to
 * obtain tokens. The verifier, kept server-side between the redirect out and the
 * callback back, is what proves the exchange comes from whoever started the
 * flow.
 *
 * 32 random bytes, base64url — comfortably inside RFC 7636's 43-128 character
 * window, and `base64url` avoids the padding and `+/` characters that would
 * otherwise have to survive a URL round trip.
 */
export const createPkcePair = (): PkcePair => {
  const codeVerifier = randomBytes(32).toString('base64url');
  return { codeVerifier, codeChallenge: challengeFor(codeVerifier) };
};

/** The S256 challenge for a verifier: `BASE64URL(SHA256(verifier))`. */
export const challengeFor = (codeVerifier: string): string =>
  createHash('sha256').update(codeVerifier).digest('base64url');

/**
 * An opaque, unguessable value for `state` or `nonce`.
 *
 * They defend different things and both are required: `state` ties the callback
 * to the browser that began the flow (CSRF), `nonce` ties the returned
 * `id_token` to that same request (replay).
 */
export const createOpaqueValue = (): string =>
  randomBytes(32).toString('base64url');
