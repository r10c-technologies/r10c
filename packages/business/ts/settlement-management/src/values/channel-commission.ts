import type { SalesChannelType } from '@r10c/business-ts-sales-vocabulary';

/**
 * Commission rates by channel type, in basis points. Partial: a channel type
 * with no entry is charged the agreement's default rate.
 *
 * The key is the **real** `SalesChannelType`, from the `business:policy`
 * vocabulary both this domain and `sales-management` depend on. It used to be a
 * local `CommissionableChannelTypes` copy of the same four literals, because
 * `business:domain` may never depend on another `business:domain` and there was
 * no third place for the set to live. Nothing kept the two lists in step, so a
 * channel type added there and not here became unpriceable and fell through to
 * the default rate below — a wrong invoice rather than an error
 * ([ADR 0056](../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md),
 * which struck ADR 0024's "not doing either now").
 */
export type ChannelCommissionRates = Readonly<
  Partial<Record<SalesChannelType, number>>
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
 *
 * `channelType` stays a `string` rather than the union: it arrives off a
 * `RelatedChannel` copied onto an order months ago, and a document written
 * before a type was retired must still price rather than fail to compile.
 */
export const commissionForChannel = (
  rates: ChannelCommissionRates | undefined,
  defaultBasisPoints: number,
  channelType: string | undefined,
): number => {
  if (rates === undefined || channelType === undefined) {
    return defaultBasisPoints;
  }

  const rate = rates[channelType as SalesChannelType];

  return rate === undefined ? defaultBasisPoints : rate;
};
