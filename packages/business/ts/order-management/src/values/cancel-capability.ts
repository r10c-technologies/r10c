import { createHash, timingSafeEqual } from 'node:crypto';

import { Context } from 'effect';

/**
 * How long after placement a buyer may still cancel their own order.
 *
 * A tag rather than a configuration read inside the route, for the standing
 * reason: a route reaching for `ConfigurationRepositoryTag` makes its own
 * failure mode "the row was missing" at request time, where the composition root
 * makes it "the process did not boot".
 */
export class CancelWindowSeconds extends Context.Service<
  CancelWindowSeconds,
  number
>()('CancelWindowSeconds') {}

/**
 * How many days after placement the buyer's capability may still read the
 * receipt (`order.receiptDays`). Longer than the cancel window by design: a
 * parcel takes days, and the receipt is how the buyer follows it. The
 * storefront sizes its cookie from the group's own stamp, so this number lives
 * in one place (ADR 0076 §6).
 */
export class ReceiptDays extends Context.Service<ReceiptDays, number>()(
  'ReceiptDays',
) {}

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
export type CapabilityRefusal =
  | 'noCapability'
  | 'badCapability'
  | 'windowClosed';

/** As much of a group as verifying a buyer's capability needs. */
export interface BuyerCapabilityHolder {
  readonly cancelDigest?: string;
  readonly cancelWindowEndsAt?: Date | string;
  readonly receiptEndsAt?: Date | string;
}

const matches = (provided: string, expected: string): boolean => {
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared
  // first — which leaks only the length of a digest whose length is a constant.
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * One digest, checked against one of the group's own stamps.
 *
 * ⚠️ **The group is the authority, not the credential.** Nothing here is signed
 * and nothing carries a claim: the digest on the record says which nonce is the
 * right one and the timestamp on the record says until when. That is what makes
 * a window revocable — clearing either member ends it — and what keeps a key
 * rotation from silently invalidating every live capability at once.
 *
 * ⚠️ **A group with no digest refuses every nonce, including an absent one.** A
 * counter sale carries none, and "no capability was required" must never be
 * reachable from "no capability was presented".
 *
 * Answers a refusal rather than a boolean so the route can say which of the
 * three it was without re-deriving it. Every refusal is answered `401` to the
 * caller; the distinction is for the trace.
 */
const verifyUntil = (
  cancelDigest: string | undefined,
  endsAtValue: Date | string | undefined,
  nonce: string | undefined,
  now: Date,
): CapabilityRefusal | undefined => {
  if (cancelDigest === undefined || cancelDigest === '') return 'noCapability';
  if (endsAtValue === undefined) return 'noCapability';

  if (nonce === undefined || nonce === '') return 'badCapability';
  if (!matches(digestOf(nonce), cancelDigest)) return 'badCapability';

  // Read as a `Date` or as the ISO string a round trip through JSON leaves
  // behind: the projection reads groups back both ways, and a window that
  // silently never closes is worse than one that never opens.
  const endsAt = new Date(endsAtValue);
  if (Number.isNaN(endsAt.getTime()) || endsAt.getTime() <= now.getTime()) {
    return 'windowClosed';
  }

  return undefined;
};

/**
 * May the holder of this nonce **cancel** an order in this group? Only before
 * `cancelWindowEndsAt` (ADR 0058 §5).
 */
export const verifyCancelCapability = (
  group: BuyerCapabilityHolder,
  nonce: string | undefined,
  now: Date,
): CapabilityRefusal | undefined =>
  verifyUntil(group.cancelDigest, group.cancelWindowEndsAt, nonce, now);

/**
 * May the holder of this nonce **read** this group's receipt? Only before
 * `receiptEndsAt` — days past the cancel window, so a buyer who can no longer
 * cancel can still see what they bought and where it goes (ADR 0076 §6).
 */
export const verifyReceiptCapability = (
  group: BuyerCapabilityHolder,
  nonce: string | undefined,
  now: Date,
): CapabilityRefusal | undefined =>
  verifyUntil(group.cancelDigest, group.receiptEndsAt, nonce, now);
