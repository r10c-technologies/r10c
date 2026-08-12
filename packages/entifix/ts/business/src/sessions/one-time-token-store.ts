import type { EntifixError } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

/**
 * What a token is for. Namespacing them keeps a token minted for one purpose
 * from being redeemed as another — a password-reset token must not double as
 * an email-verification token.
 */
export type TokenPurpose = string;

/**
 * Short-lived, single-use tokens handed to a user out of band (a link in an
 * email) and redeemed once.
 *
 * The store keeps only a HASH of the token, exactly as it would a password: the
 * plaintext exists in the response to {@link OneTimeTokenStore.issue} and in the
 * message sent to the user, and nowhere else. A store dump then yields nothing
 * an attacker can redeem.
 */
export interface OneTimeTokenStore {
  /**
   * Mint a token for `subject`, returning the plaintext exactly once.
   *
   * The caller must send it onward immediately; there is no way to read it back.
   */
  issue(
    purpose: TokenPurpose,
    subject: string,
    ttlSeconds: number,
  ): Effect<string, EntifixError>;
  /**
   * Redeem a token, returning the subject it was minted for.
   *
   * Consuming deletes it, so a link that leaks later — from a browser history, a
   * mail archive, a proxy log — is already spent. Fails when the token is
   * unknown, expired, or already used; the caller must not distinguish those.
   */
  consume(purpose: TokenPurpose, token: string): Effect<string, EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link OneTimeTokenStore}. */
export class OneTimeTokenStoreTag extends Context.Tag('OneTimeTokenStoreTag')<
  OneTimeTokenStoreTag,
  OneTimeTokenStore
>() {}
