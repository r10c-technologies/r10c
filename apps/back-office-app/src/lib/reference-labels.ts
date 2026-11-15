import type { ReferenceLabelRegistration } from '@entifix/business';
import { CATALOG_REFERENCE_LABELS } from '@r10c/shells-next-marketplace-admin';
import { ORDER_REFERENCE_LABELS } from '@r10c/shells-next-order';
import { SETTLEMENT_REFERENCE_LABELS } from '@r10c/shells-next-settlement';

/**
 * Where every reference on a back-office screen reads its target's name
 * (entifix 0030).
 *
 * A member declared `references: { entity }` is a cross-store id — a stock
 * item's offering, a payout's vendor — and a list that shows it reads the
 * target's name once per page, by `id=in=(…)`, through the adapter **the
 * target's own shell** builds. This host only lists them, as it lists `NAV`, so
 * no shell builds another domain's adapter (ADR 0077), and every name is read
 * under the reader's own session, narrowed exactly as the target's screen is.
 *
 * Orders and settlement runs are registered although neither has a member a
 * person reads it by: registered, a reference to one reads as entifix's
 * short-id fallback ("Pedido «8a564966»"); unregistered, as its whole id. The
 * checkout group is not — a vendor never reads one (ADR 0069), and no
 * back-office list shows a `groupId`.
 */
export const REFERENCE_LABELS: readonly ReferenceLabelRegistration[] = [
  ...CATALOG_REFERENCE_LABELS,
  ...ORDER_REFERENCE_LABELS,
  ...SETTLEMENT_REFERENCE_LABELS,
];
