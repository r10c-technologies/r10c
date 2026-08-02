/**
 * **stock-management** — tenant plane.
 *
 * Physical availability. Quantities move only by atomic in-place operators over
 * an append-only `StockMovement` ledger — never read-modify-write — and a
 * purchase takes a *conditional* reservation rather than a decrement, which is
 * itself the concurrency control.
 *
 * ODA analogue: none — telecom has no warehouse, and TMF637 "Product Inventory" means
 * subscribed instances, not stock. That name stays free for subscriptions.
 *
 * Governing decision:
 * [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing next: `StockItem`, `StockMovement`, `Reservation`.
 * Until then this package exports its domain name, which is already load-bearing
 * (permission namespace, entitlement key, package identity).
 */
export { STOCK_DOMAIN } from './domain';
