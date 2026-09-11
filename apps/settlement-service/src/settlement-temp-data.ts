/**
 * The demo vendor's agreement, in the entity wire shape.
 *
 * Wire shape rather than a constructed instance, for the reason every other seed
 * in the fleet is: it inserts verbatim and reads back through the entifix
 * deserializer, so a mistake in a member name fails a read rather than passing
 * silently through a setter.
 *
 * ⚠️ **`counter: 0` is the row that makes the feature visible.** ADR 0024 put a
 * per-channel rate on the agreement for exactly this term — the platform takes
 * 8% on a sale it sourced through the storefront and nothing on one the vendor
 * made to their own walk-in — and a lab where every channel charges the same
 * rate cannot tell a correct implementation from `rates[type] || fallback`,
 * which charges full commission for a free channel. The storefront sale and the
 * counter sale in the same lab price differently, and that difference is the
 * assertion.
 *
 * `storefront` is left absent rather than written as `800`, so the seed also
 * exercises the fall-through: an absent entry takes the default, and absent and
 * `0` are different values rather than different spellings of the same one.
 */
export const agreementTempData = (organizationId: string) => [
  {
    id: `agreement-${organizationId}`,
    vendorId: organizationId,
    commissionBasisPoints: 800,
    channelCommissionBasisPoints: { counter: 0 },
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  },
];
