/**
 * **marketplace-catalog** — platform plane, `published-catalog` store.
 *
 * The catalog the storefront actually reads: a projection of every vendor's
 * approved offerings, `truth: projection-of:catalog`.
 *
 * Vendors author in tenant storage and the storefront is platform-scope with no
 * session and therefore no organization to resolve, so "the catalog" cannot be
 * one thing. Publication copies rather than links — a platform-plane reader
 * cannot dereference a tenant pointer without the isolation break the plane
 * split exists to prevent
 * ([ADR 0009](../../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 *
 * The **writer is this slice, not the author's**: `marketplace` consumes
 * `catalog.published` off the bus and writes its own store, which is what keeps
 * the public read host out of tenant storage entirely
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * The vocabulary this catalog is classified in — brands, categories, dictionary
 * terms — is **not** here. It is system-of-record in `catalog-reference`, and a
 * store carries one `truth`.
 *
 * ODA analogue: Product Catalog Management, published view.
 *
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { MARKETPLACE_CATALOG_DOMAIN } from './domain';
export * from './entities/published-offering';
