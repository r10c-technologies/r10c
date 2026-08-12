/**
 * **product-configuration-management** — tenant plane, `catalog` store.
 *
 * Where a vendor authors its own catalog: what a thing *is*
 * (`ProductSpecification`), how it is sold (`ProductOffering` +
 * `ProductOfferingPrice`), and — because a vendor's new field must not be a
 * platform release — the versioned product model itself
 * (`EntitySpecification` + `CharacteristicSpecification`).
 *
 * Everything here is **per organization**, physically `tenant_<organizationId>`.
 * The storefront cannot read it: publication projects the approved subset into
 * the platform-plane `published-catalog` store, which is what makes the two
 * catalogs one projection rather than one shared table
 * ([ADR 0009](../../../../docs/adr/0009-catalog-authoring-and-publication.md)).
 *
 * `ProductBrand` and `ProductCategory` live in **`business-ts-catalog-reference`**,
 * platform plane: a brand is not per-vendor, and two vendors' private
 * "Electronics" rows can never merge into one browse tree
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 * `ProductSpecification` therefore names them by **id**, not by a typed link —
 * this package may not import another `business:domain`, and a storage-layer
 * join across a store boundary is the coupling the split exists to prevent.
 *
 * ODA analogue: Product Catalog Management (TMFC001), Product Configurator (TMFC027)
 */
export * from './entities/characteristic-specification';
export * from './entities/entity-specification';
export * from './entities/product-offering';
export * from './entities/product-offering-price';
export * from './entities/product-specification';
export * from './values';
