/**
 * How a buyer pays one vendor's order: a card captured at checkout, cash at a
 * vendor's counter, or cash handed to a courier on delivery.
 *
 * Chosen **per seller** rather than per basket, because a checkout group holds
 * one order per vendor and only some vendors ship cash on delivery
 * ([ADR 0070](../../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 *
 * One closed set, here in `business:policy`, because four domains carry it and
 * none may import another: the order records it, payment captures or collects
 * by it, the shipping order knows how much the courier must collect, and the
 * flow catalog segments a checkout by it. `cod` is the wire value everywhere —
 * a recipe's segment tag and a fragment's `excludedFrom` included.
 *
 * Payment's own vocabulary is wider (`voucher`, `transfer`), because a payment
 * record describes money however it arrived; this is only what a buyer can
 * pick.
 */
export const OrderTenders = ['card', 'cash', 'cod'] as const;

export type OrderTender = (typeof OrderTenders)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a tender. */
export const isOrderTender = (value: unknown): value is OrderTender =>
  typeof value === 'string' && (OrderTenders as readonly string[]).includes(value);
