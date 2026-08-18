/**
 * The channel-type names a commission rate can be set against.
 *
 * **Duplicated from `sales-management`'s `SalesChannelTypes` on purpose**, and
 * the duplication is structural rather than lazy: `business:domain` may never
 * depend on another `business:domain`, so importing the real union is an illegal
 * edge the build rejects. This is the same shape as every cross-store id in the
 * repository — `ProductSpecification.brandId` is a bare string for exactly this
 * reason — except that here the *values* are copied rather than a key.
 *
 * The cost, stated so nobody discovers it later: nothing keeps the two lists in
 * step. A channel type added in `sales-management` and not here silently becomes
 * unpriceable, falling through to the default rate. `settlement.spec.ts` pins
 * the list so at least the drift is visible in a diff, and the real fix — if
 * this ever bites — is a shared `business:policy` vocabulary package, not a
 * dependency edge.
 *
 * @see ADR 0024
 */
export const CommissionableChannelTypes = [
  'storefront',
  'counter',
  'phone',
  'external',
] as const;

export type CommissionableChannelType =
  (typeof CommissionableChannelTypes)[number];

/**
 * Commission rates by channel type, in basis points. Partial: a channel type
 * with no entry is charged the agreement's default rate.
 */
export type ChannelCommissionRates = Readonly<
  Partial<Record<CommissionableChannelType, number>>
>;

/**
 * The rate that applies to a line, in basis points.
 *
 * An explicit channel rate wins; anything else — an unknown channel type, a
 * channel with no override, a line with no channel at all — falls back to the
 * agreement's default. That fallback is why a rate of `0` has to be honoured
 * rather than treated as absent: "we take nothing on your own counter" is the
 * whole reason per-channel rates exist, and `rates[type] || fallback` would
 * silently charge full commission for it.
 */
export const commissionForChannel = (
  rates: ChannelCommissionRates | undefined,
  defaultBasisPoints: number,
  channelType: string | undefined,
): number => {
  if (rates === undefined || channelType === undefined) {
    return defaultBasisPoints;
  }

  const rate = rates[channelType as CommissionableChannelType];

  return rate === undefined ? defaultBasisPoints : rate;
};
