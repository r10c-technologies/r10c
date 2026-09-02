/**
 * **catalog-reference** — platform plane, `catalog-reference` store.
 *
 * The shared vocabulary a marketplace catalog is expressed in: brands,
 * categories, and the characteristic dictionary. **Operator-authored, read by
 * everyone**, including anonymous storefront traffic.
 *
 * It exists because a marketplace has to merge. Brand and category were
 * originally tenant-owned, which meant Sony was a per-vendor row and two
 * vendors' private "Electronics" could never become one browse tree or one
 * facet — the storefront degrades to per-vendor strings, which is the definition
 * of not being a marketplace
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * Its store is **system-of-record**, deliberately separate from the
 * `published-catalog` store the same slice owns: that one is
 * `projection-of:catalog`, and a store carries exactly one `truth`. Two truths
 * is what makes these two domains rather than one.
 *
 * Not entitlement-grantable — see {@link CATALOG_REFERENCE_DOMAIN}.
 *
 * ODA analogue: Product Catalog Management (TMFC001), the classification half.
 *
 * Governing decisions:
 * [ADR 0014](../../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)
 * for the dictionary. The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * A specification in `product-configuration-management` references these by
 * **id**, never by a typed link: that package may not import this one, and
 * nothing enforces the reference across the store boundary — so a dangling id is
 * a display gap, never a corrupt record.
 */
export { CATALOG_REFERENCE_DOMAIN } from './domain';
export * from './entities/dictionary-term';
export * from './entities/product-brand';
export * from './entities/product-category';
export * from './use-cases';
export * from './values';
