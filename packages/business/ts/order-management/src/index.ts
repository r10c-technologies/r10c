/**
 * **order-management** — platform plane.
 *
 * Cart and order capture. An order holds a stock *reservation id*, never a
 * quantity: reserving is a synchronous call into the tenant plane because the
 * buyer needs an answer now, and a failed order write compensates by releasing
 * the reservation through the saga.
 *
 * ODA analogue: Product Order Capture & Validation (TMFC002)
 *
 * Governing decision:
 * [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing next: `Cart`, `ProductOrder`, `OrderItem` and the order state machine.
 * Until then this package exports its domain name, which is already load-bearing
 * (permission namespace, entitlement key, package identity).
 */
export { ORDER_DOMAIN } from './domain';
