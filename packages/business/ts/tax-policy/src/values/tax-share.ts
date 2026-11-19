/** What one payment allocation captured, and the tax stated into it. */
export interface TaxedAllocation {
  readonly captured: number;
  readonly taxableBase: number;
  readonly taxAmount: number;
}

/** A refund's share of its allocation's base and tax. */
export interface TaxShare {
  readonly taxableBase: number;
  readonly taxAmount: number;
}

const roundedShare = (value: number, part: number, whole: number): number =>
  whole === 0
    ? 0
    : Number(
        (2n * BigInt(value) * BigInt(part) + BigInt(whole)) /
          (2n * BigInt(whole)),
      );

/**
 * The base and tax a refund of `amount` gives back, when `refundedBefore` of
 * the allocation was already refunded.
 *
 * Computed as the difference of two cumulative shares, so however a capture is
 * refunded in parts the shares telescope: the refunds that reach the whole
 * capture give back exactly the base and tax it carried, never a centavo more
 * or less (ADR 0078 §6, "a `Refund` mirrors its share").
 */
export const taxShareOf = (
  allocation: TaxedAllocation,
  refundedBefore: number,
  amount: number,
): TaxShare => {
  const cumulative = (refunded: number) => ({
    taxableBase: roundedShare(
      allocation.taxableBase,
      refunded,
      allocation.captured,
    ),
    taxAmount: roundedShare(
      allocation.taxAmount,
      refunded,
      allocation.captured,
    ),
  });
  const before = cumulative(refundedBefore);
  const after = cumulative(refundedBefore + amount);
  return {
    taxableBase: after.taxableBase - before.taxableBase,
    taxAmount: after.taxAmount - before.taxAmount,
  };
};
