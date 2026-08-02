/**
 * **marketplace-catalog** — platform plane.
 *
 * The published catalog the storefront reads. A projection, never authored
 * directly: vendors author offerings in their own tenant storage and *publish*
 * them here, which is why a record in this domain is a snapshot (price, terms,
 * vendor identity) rather than a pointer into a tenant database — a
 * platform-plane reader cannot dereference one without breaking isolation.
 *
 * ODA analogue: Product Catalog Management (TMFC001), published view
 *
 * Governing decision:
 * [ADR 0009](../../../../docs/adr/0009-catalog-authoring-and-publication.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing next: The published offering projection and its rebuild path.
 * Until then this package exports its domain name, which is already load-bearing
 * (permission namespace, entitlement key, package identity).
 */
export { MARKETPLACE_CATALOG_DOMAIN } from './domain';
