/**
 * **settlement-management** — platform plane.
 *
 * What the platform owes each vendor. Commission terms live on an `Agreement` —
 * the contract between platform and vendor — rather than being scattered across
 * settlement runs, so a rate change is one record with a history.
 *
 * ODA analogue: Agreement Management (TMFC039) plus partner revenue
 *
 * Governing decision:
 * [ADR 0005](../../../../docs/adr/0005-business-domain-decomposition.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing next: `Agreement`, `SettlementRun`, `VendorPayout`.
 * Until then this package exports its domain name, which is already load-bearing
 * (permission namespace, entitlement key, package identity).
 */
export { SETTLEMENT_DOMAIN } from './domain';
