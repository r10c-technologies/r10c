/**
 * Where an order is in its life.
 *
 * `pending` → `paid` → `fulfilled`, with `cancelled` reachable from the first
 * two. The states are about **money and promises**, not about logistics: there
 * is no `shipped` because fulfillment is deliberately out of v1 scope, and
 * adding it later is a member here rather than a second status field.
 *
 * `paid` is the state that converts a stock {@link Reservation} to a sale
 * movement; `cancelled` releases it. That pairing is why the two vocabularies
 * are kept separate — an order status is the buyer's view, a reservation status
 * is the vendor's stock, and collapsing them would make one domain write the
 * other's record.
 */
export const OrderStatuses = [
  'pending',
  'paid',
  'fulfilled',
  'cancelled',
] as const;

export type OrderStatus = (typeof OrderStatuses)[number];

/** Narrow an unknown value to an order status. */
export const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' &&
  (OrderStatuses as readonly string[]).includes(value);
