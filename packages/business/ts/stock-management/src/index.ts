/**
 * **stock-management** — tenant plane, `stock` store.
 *
 * Physical availability. Quantities move only by atomic in-place operators over
 * an append-only {@link StockMovement} ledger — never read-modify-write — and a
 * purchase takes a *conditional* {@link Reservation} rather than a decrement,
 * which is itself the concurrency control.
 *
 * Its store is deliberately **not** the catalog's, even though both are tenant
 * plane and both are partitioned per organization: a product definition is owned
 * by product-configuration-management and a quantity by this domain, so one
 * record written by two domains is the coupling the decomposition exists to
 * prevent. Physically that is `stock_<organizationId>` beside
 * `tenant_<organizationId>`, which makes the one-writer rule a property of the
 * database handle rather than of review
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * ODA analogue: none — telecom has no warehouse, and TMF637 "Product Inventory" means
 * subscribed instances, not stock. That name stays free for subscriptions.
 *
 * Governing decision:
 * [ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { STOCK_DOMAIN } from './domain';
export * from './entities/reservation';
export * from './entities/stock-item';
export * from './entities/stock-movement';
export * from './values';
