/**
 * One line of an order, tagged with the vendor that owes it.
 *
 * A **value**, not an entity: it has no identity of its own and is never
 * addressed apart from the order that holds it, so it is embedded rather than
 * linked ([ADR 0022](../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * `vendorId` on the line is what lets one checkout across several vendors be a
 * single `ProductOrder` — one receipt for the buyer — while settlement still
 * aggregates per vendor. The alternative, one order per vendor, makes settlement
 * trivial and shows the buyer N orders for one payment.
 *
 * The price is **captured here**, not read through to the offering. A buyer must
 * be charged the price they were shown, and an offering's price can change
 * between the cart and the payment.
 *
 * `reservationId` holds the stock hold this line took. order-management holds an
 * **id, never a quantity** — which is what lets a failed order compensate by
 * releasing the hold rather than by reversing arithmetic it never performed
 * ([ADR 0010](../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * The known cost of embedding: "orders for vendor X" is a query into an array
 * rather than a top-level filter, so a vendor-facing order list needs an index
 * on the embedded path or a projection. Accepted, because the buyer's single
 * receipt is the shape the storefront is built around.
 */
export interface OrderItem {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
  /** Minor units, captured at checkout. See `ProductOfferingPrice.amount`. */
  readonly amount: number;
  readonly currency: string;
  /** The stock hold this line took, released on cancellation. */
  readonly reservationId?: string;
}
