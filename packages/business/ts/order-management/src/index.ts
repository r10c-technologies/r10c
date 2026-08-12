/**
 * **order-management** — platform plane, `order` store.
 *
 * Order capture. One checkout produces one {@link ProductOrder}, even when the
 * basket spans several vendors: the multi-vendor case rides on vendor-tagged
 * {@link OrderItem} lines, so the buyer gets one receipt and settlement still
 * aggregates per vendor
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * A line holds a stock *reservation id*, never a quantity: reserving is a
 * synchronous call into the tenant plane because the buyer needs an answer now,
 * and a failed order write compensates by releasing the reservation through the
 * saga. That call cannot resolve its tenant from the session — a buyer holds no
 * organization, and the vendor comes from the item — so it crosses through
 * [ADR 0023](../../../../docs/adr/0023-service-to-service-tenant-crossing.md).
 *
 * The **cart is a cookie**, not an entity here: the storefront's first response
 * has to be correct without a round trip, and a server-side cart would add the
 * only anonymous write surface in the fleet.
 *
 * ODA analogue: Product Order Capture & Validation (TMFC002)
 *
 * Governing decisions:
 * [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing with the SID rename: `Product` — the instance a buyer owns once an
 * order completes, which is what a subscription later becomes. It waits because
 * its entity key is `product`, and product-configuration-management still holds
 * that key until it becomes `ProductSpecification`.
 */
export { ORDER_DOMAIN } from './domain';
export * from './entities/product-order';
export * from './values';
