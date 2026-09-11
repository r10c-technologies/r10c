/**
 * Where an order is in its life.
 *
 * `pending` → `paid` → `fulfilled`, with `cancelled` reachable from **`paid`
 * alone** and only through `cancelling`. The states are about **money and
 * promises**, not about logistics: there is no `shipped` because fulfillment is
 * deliberately out of v1 scope, and adding it later is a member here rather than
 * a second status field.
 *
 * ⚠️ **`cancelling` is a claim, not a phase.** The conditional write
 * `paid → cancelling` is what stops two cancels running at once — the semantic
 * lock a compensatable step takes so a second flow can see the first one holding
 * the record, and the same trick `transitionReservation` uses for a hold. A
 * saga's command id is stable across attempts of **one** flow and so says
 * nothing about two, which is why it cannot do this job. A stranded
 * cancellation therefore leaves the order visibly `cancelling` rather than
 * silently wrong, which is the state a sweep or a person can act on
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md) §3).
 *
 * ⚠️ **`pending` is not cancellable, and this line used to say it was.** A
 * `pending` order is a checkout still in flight or a saga that stranded, and
 * undoing one is the coordinator's job — a second actor cancelling underneath it
 * would race the compensation that is already on its way. A `fulfilled` order is
 * a return, which is goods coming back and out of scope here
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * `paid` is the state that converts a stock {@link Reservation} to a sale
 * movement; cancelling a paid order puts the quantity back as a new
 * `cancellation` movement, because by then the hold is spent and the ledger is
 * append-only. That pairing is why the two vocabularies
 * are kept separate — an order status is the buyer's view, a reservation status
 * is the vendor's stock, and collapsing them would make one domain write the
 * other's record.
 */
export const OrderStatuses = [
  'pending',
  'paid',
  'cancelling',
  'fulfilled',
  'cancelled',
] as const;

export type OrderStatus = (typeof OrderStatuses)[number];

/** Narrow an unknown value to an order status. */
export const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' &&
  (OrderStatuses as readonly string[]).includes(value);
