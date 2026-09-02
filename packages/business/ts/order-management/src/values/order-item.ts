import { accessor } from '@r10c/entifix-ts-core';

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
 *
 * ## Why this is a class with accessors, and not an interface
 *
 * It is the child of `ProductOrder`'s `composition` member, and a composition's
 * child is **described by its accessors** — that is the whole mechanism
 * ([ADR 0034](../../../../../docs/adr/0034-composition-metadata.md)). There is
 * no `@entity()` here and there must not be: `@accessor()` writes to this
 * class's own metadata bag with no help from it, and a value with no `id` has
 * no domain, no key and no permission namespace to declare.
 *
 * ⚠️ The class is a **shape declaration, not a runtime contract.** A line
 * arriving off the wire is a plain object — `deserializeSingleEntity` assigns
 * the embedded array through, and an autosaved draft must stay JSON
 * ([ADR 0032](../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md))
 * — so nothing may test `instanceof OrderItem`. Construct one when authoring;
 * read one as data.
 */
export class OrderItem {
  // #region properties
  #offeringId: string;
  #vendorId: string;
  #quantity: number;
  #amount: number;
  #currency: string;
  #reservationId?: string;
  // #endregion

  // #region constructors
  constructor(
    offeringId = '',
    vendorId = '',
    quantity = 0,
    amount = 0,
    currency = '',
    reservationId?: string,
  ) {
    this.#offeringId = offeringId;
    this.#vendorId = vendorId;
    this.#quantity = quantity;
    this.#amount = amount;
    this.#currency = currency;
    this.#reservationId = reservationId;
  }
  // #endregion

  // #region accessors
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.offeringId',
    required: true,
  })
  get offeringId(): string {
    return this.#offeringId;
  }
  set offeringId(value: string) {
    this.#offeringId = value;
  }

  /** The vendor that owes this line. See the class note on multi-vendor orders. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.vendorId',
    required: true,
  })
  get vendorId(): string {
    return this.#vendorId;
  }
  set vendorId(value: string) {
    this.#vendorId = value;
  }

  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.quantity',
    required: true,
  })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  /** Minor units, captured at checkout. See `ProductOfferingPrice.amount`. */
  @accessor({
    type: 'number',
    labelKey: 'entity:product-order.fields.item.amount',
    required: true,
  })
  get amount(): number {
    return this.#amount;
  }
  set amount(value: number) {
    this.#amount = value;
  }

  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.currency',
    required: true,
  })
  get currency(): string {
    return this.#currency;
  }
  set currency(value: string) {
    this.#currency = value;
  }

  /** The stock hold this line took, released on cancellation. */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.item.reservationId',
  })
  get reservationId(): string | undefined {
    return this.#reservationId;
  }
  set reservationId(value: string | undefined) {
    this.#reservationId = value;
  }
  // #endregion
}
