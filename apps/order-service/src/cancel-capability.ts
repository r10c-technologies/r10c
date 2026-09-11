import { createHash, timingSafeEqual } from 'node:crypto';

import { Context } from 'effect';

/**
 * How long after placement a buyer may still cancel their own order.
 *
 * ⚠️ **It must equal the storefront's `RECEIPT_TTL_SECONDS`.** The receipt
 * cookie is the only place the nonce lives, so a window wider than the cookie is
 * a capability nobody can present, and a cookie that outlives the window is a
 * Cancel button that quietly stops working. Two constants, one number, and this
 * note in both places is the only thing keeping them together
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * A tag rather than a configuration read inside the route, for the standing
 * reason: a route reaching for `ConfigurationRepositoryTag` makes its own
 * failure mode "the row was missing" at request time, where the composition root
 * makes it "the process did not boot".
 */
export class CancelWindowSeconds extends Context.Tag('CancelWindowSeconds')<
  CancelWindowSeconds,
  number
>() {}

/**
 * What is stored for a nonce the browser holds.
 *
 * SHA-256 and no salt, which is the right call **only** because the input is
 * 256 bits of `randomBytes` rather than anything a person chose: there is no
 * dictionary to iterate and nothing to rainbow-table. The same shape
 * `RedisOneTimeTokenStore` uses, and for the same reason.
 */
export const digestOf = (nonce: string): string =>
  createHash('sha256').update(nonce, 'utf8').digest('hex');

/** Why a capability was refused, or `undefined` when it was not. */
export type CancelRefusal = 'noCapability' | 'badCapability' | 'windowClosed';

/** As much of an order as verifying a buyer's capability needs. */
export interface CancellableOrder {
  readonly cancelDigest?: string;
  readonly cancelWindowEndsAt?: Date | string;
}

const matches = (provided: string, expected: string): boolean => {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — which leaks only the length of a digest whose length is a constant.
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * May the holder of this nonce cancel this order?
 *
 * ⚠️ **The order is the authority, not the credential.** Nothing here is signed
 * and nothing carries a claim: the digest on the record says which nonce is the
 * right one and the timestamp on the record says until when. That is what makes
 * the window revocable — clearing either member ends it — and what keeps a key
 * rotation from silently invalidating every live capability at once.
 *
 * ⚠️ **An order with no digest refuses every nonce, including an absent one.** A
 * counter sale carries none, and "no capability was required" must never be
 * reachable from "no capability was presented".
 *
 * Answers a refusal rather than a boolean so the route can say which of the
 * three it was without re-deriving it. Every refusal is answered `401` to the
 * caller; the distinction is for the log.
 */
export const verifyCancelCapability = (
  order: CancellableOrder,
  nonce: string | undefined,
  now: Date,
): CancelRefusal | undefined => {
  const { cancelDigest, cancelWindowEndsAt } = order;

  if (
    cancelDigest === undefined ||
    cancelDigest === '' ||
    cancelWindowEndsAt === undefined
  ) {
    return 'noCapability';
  }

  if (nonce === undefined || nonce === '') return 'badCapability';
  if (!matches(digestOf(nonce), cancelDigest)) return 'badCapability';

  // Read as a `Date` or as the ISO string a round trip through JSON leaves
  // behind: the projection reads orders back both ways, and a window that
  // silently never closes is worse than one that never opens.
  const endsAt = new Date(cancelWindowEndsAt);
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) {
    return 'windowClosed';
  }

  return undefined;
};
