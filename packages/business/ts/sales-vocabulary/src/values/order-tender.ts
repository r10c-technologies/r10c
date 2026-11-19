/**
 * How a buyer pays one vendor's order: a card captured at checkout, cash at a
 * vendor's counter, cash handed to a courier on delivery, or a payment link the
 * seller sends and confirms once the money reached them
 * ([ADR 0081](../../../../../docs/adr/0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md)).
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
export const OrderTenders = ['card', 'cash', 'cod', 'link'] as const;

export type OrderTender = (typeof OrderTenders)[number];

/** Narrow an unknown value (a request body, a Mongo document) to a tender. */
export const isOrderTender = (value: unknown): value is OrderTender =>
  typeof value === 'string' &&
  (OrderTenders as readonly string[]).includes(value);

/**
 * Whether a tender is paid outside the platform and confirmed by the seller:
 * `link` alone today. The checkout recipe asks this rather than comparing the
 * literal, so a bank deposit with a slip is a vocabulary edit, not a new
 * branch (ADR 0081 §1).
 */
export const confirmedBySeller = (tender: string): boolean => tender === 'link';

/**
 * Whether the money for a tender reaches the seller rather than the platform:
 * cash a courier collected, or a link paid into the seller's own acquirer
 * account. Settlement writes such a sale `collectedBy: 'vendor'`, and an order
 * cancelled with nothing collected voids its join (ADR 0069, ADR 0081 §5).
 */
export const collectedByVendor = (tender: string): boolean =>
  tender === 'cod' || tender === 'link';
