/**
 * **settlement-management** — **control** plane, `settlement` store.
 *
 * What the platform owes each vendor, and on what terms. An {@link Agreement}
 * holds the commission; a {@link CommissionEntry} records each sale's cut as it
 * happens; a {@link SettlementRun} folds a period's entries into
 * {@link VendorPayout} totals.
 *
 * The ledger-then-fold shape is the same one stock uses, for the same reason: a
 * payout computed at run time from whatever the agreement says *today* would let
 * a rate change silently rewrite history. Capturing commission at sale time is
 * what makes a payout defensible in a dispute.
 *
 * **Control plane, not platform**, which is the one place this domain differs
 * from its commerce neighbours. The rule is who may read it, and this is the
 * platform's own record about a vendor — the same character as `Entitlement`,
 * and nothing like a public catalog. A slice owning stores in more than one
 * plane is explicitly allowed
 * ([ADR 0020](../../../../docs/adr/0020-stores-and-slices.md)).
 *
 * ODA analogue: Agreement Management (TMFC039), partner revenue.
 *
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * This is the surface that generalizes furthest: any partner revenue share, in
 * any future non-commerce application, is this shape with a different ledger
 * feeding it.
 */
export { SETTLEMENT_DOMAIN } from './domain';
export * from './entities/agreement';
export * from './entities/commission-entry';
export * from './entities/settlement-run';
export * from './entities/vendor-payout';
export * from './values';
