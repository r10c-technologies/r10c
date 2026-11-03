/**
 * Where one vendor's order is in its life.
 *
 * `pending` → `paid` when a card capture lands, or `pending` → `confirmed` at a
 * cash-on-delivery checkout's commit point; a paid order is `confirmed` once its
 * checkout commits. From `confirmed` it is `dispatched` with its shipment, then
 * `fulfilled` on delivery — or `cancelled` when the parcel is refused or
 * returned. `cancelled` is reachable before dispatch only through `cancelling`.
 *
 * ⚠️ **`cancelling` is a claim, not a phase.** The conditional write into it is
 * what stops two cancels running at once — the semantic lock a compensatable
 * step takes so a second flow can see the first holding the record. A stranded
 * cancellation therefore leaves the order visibly `cancelling` rather than
 * silently wrong, which is the state a sweep or a person can act on
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md) §3).
 *
 * ⚠️ **`pending` is not cancellable.** A `pending` order is a checkout still in
 * flight or a flow that stranded, and undoing one is the coordinator's job — a
 * second actor cancelling underneath it would race the compensation already on
 * its way. A `dispatched` order is not either: the goods are with a courier,
 * and only a refusal or a return closes it
 * ([ADR 0070](../../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 */
export const OrderStatuses = [
  'pending',
  'paid',
  'confirmed',
  'cancelling',
  'dispatched',
  'fulfilled',
  'cancelled',
] as const;

export type OrderStatus = (typeof OrderStatuses)[number];

/** Narrow an unknown value to an order status. */
export const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' &&
  (OrderStatuses as readonly string[]).includes(value);
