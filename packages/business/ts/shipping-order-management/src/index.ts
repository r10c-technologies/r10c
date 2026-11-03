/**
 * **shipping-order-management** — tenant plane, `fulfilment` store.
 *
 * The parcel's journey from a vendor's shelf to the buyer's door: TMF700's
 * Shipping Order, one per vendor order. Opened once a checkout commits, held
 * or withdrawn by a cancellation, dispatched as the delivery flow's pivot, and
 * closed by what the vendor records from the courier — delivered, refused,
 * returned. Cash on delivery lives here as {@link ShippingOrder.amountDue}:
 * what the courier must collect.
 *
 * Physically `fulfilment_<organizationId>`, a fourth tenant database beside
 * the catalog's, stock's and sales', written only by the `fulfilment` slice.
 *
 * Governing decision:
 * [ADR 0070](../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { SHIPPING_ORDER_DOMAIN } from './domain';
export * from './entities/shipping-order';
export * from './failures';
export * from './fragments';
export * from './ports';
export * from './use-cases';
export * from './values';
