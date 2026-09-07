import {
  type Permission,
  permissionForEntity,
  screenAddress,
} from '@r10c/business-ts-authz';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { EntifixBuildError, extractMetaEntity } from '@r10c/entifix-ts-core';
import type { EntityCatalogKey } from '@r10c/shells-next-common';

/**
 * Which of the catalog's two backends answers for a surface.
 *
 * A **symbolic tag, never a URL**. The addresses live in `server/service-urls.ts`,
 * are read from `process.env` at module scope, and ship only from `/server`;
 * putting one in this descriptor would either drag env-reading into the browser
 * bundle through `client/catalog-crud.tsx` or freeze the build-time value into
 * it. Only the server-side search fan-out resolves the tag.
 */
export type CatalogService = 'marketplace-admin' | 'marketplace';

/**
 * One catalog entity, declared once, for everything that has to name it.
 *
 * The same three entity keys used to be written out by hand in five places — two
 * const maps in the workspace registry, the search sources, the app's nav table
 * and the `makeEntityCrud` calls themselves — against the 28 entities ADR 0022
 * fixes for v1. Adding the fourth entity meant finding all five, and nothing
 * failed if you found four: a missing nav line is a screen nobody can reach, and
 * a missing registry line is a tab that opens onto nothing.
 *
 * So this is the declaration and the rest derive: the nav item, its workspace
 * address, the list tab, the record tab and the search source. What stays here
 * is what metadata genuinely cannot know — the route, the icon, the nav copy,
 * whether the domain is entitlement-gated, which backend answers, and which
 * members a search reads.
 *
 * `permission` is **not** a member. It is `permissionForEntity(…, 'read')`,
 * derived from the entity's own `@entity({ domain, key })`, which is the whole
 * point of the `<domain>:<entityKey>:<action>` shape — a hand-written domain
 * string here could name a domain the route behind it does not check.
 */
export interface CatalogSurface<TEntity extends Entity = Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  /**
   * `@entity({ key })`, stated rather than derived.
   *
   * Typed as {@link EntityCatalogKey}, so an entity whose catalog copy is
   * missing cannot be declared here at all; `makeEntityCrud` then re-reads the
   * decorator and throws if the two disagree, which is the check that survives
   * a rename of one and not the other.
   */
  readonly entityKey: EntityCatalogKey;
  /** `@entity({ pluralKey })` — the search group's heading. */
  readonly entityPluralKey: string;
  /** The route, which is **not** always the entity key: `product-specification` lives at `/catalog/product`. */
  readonly basePath: string;
  readonly icon: string;
  /** Shell-namespaced nav copy. `app:` keys are lint-restricted to `apps/`. */
  readonly navLabelKey: string;
  /** Gate the nav item on the organization's provisioning (ADR 0007's second ceiling). */
  readonly entitled?: boolean;
  readonly service: CatalogService;
  readonly searchProperty: string;
  readonly labelProperty: string;
  readonly sublabelProperty?: string;
}

/** The `read` permission guarding a surface, derived from its entity. */
export const permissionForSurface = (surface: CatalogSurface): Permission =>
  permissionForEntity(surface.entityConstructor, 'read');

/**
 * The workspace tab address for a surface's list, and for one of its records.
 *
 * Every catalog screen is Definiciones — you author the record, it has no
 * lifecycle, an offering references it (ADR 0033) — so the type is `master` here
 * rather than a member of {@link CatalogSurface}. A surface that is genuinely an
 * Operaciones screen is a different declaration, not a flag on this one.
 */
export const surfaceListAddress = (surface: CatalogSurface): string =>
  screenAddress({ type: 'master', key: surface.entityKey });

export const surfaceRecordAddress = (
  surface: CatalogSurface,
  id: string,
): string => screenAddress({ type: 'master', key: surface.entityKey, id });

type CatalogSurfaceDeclaration<TEntity extends Entity> = Omit<
  CatalogSurface<TEntity>,
  'entityConstructor' | 'entityKey' | 'entityPluralKey'
> & { readonly entityKey: EntityCatalogKey };

/**
 * Declare a surface, reading off the decorator what the decorator already knows.
 *
 * `pluralKey` is optional on `MetaEntityOptions`, so an entity that never
 * declared one fails here — at module load, where the surface is declared —
 * rather than by titling a search group `undefined` on the first keystroke.
 */
export const catalogSurface = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  declaration: CatalogSurfaceDeclaration<TEntity>,
): CatalogSurface<TEntity> => {
  const { pluralKey } = extractMetaEntity(entityConstructor);
  if (pluralKey === undefined) {
    throw new EntifixBuildError(
      `${entityConstructor.name} must declare pluralKey on @entity() to be a catalog surface`,
    );
  }
  return { ...declaration, entityConstructor, entityPluralKey: pluralKey };
};

export const PRODUCT_SURFACE = catalogSurface(ProductSpecification, {
  entityKey: 'product-specification',
  // The route segment and the entity key differ here, and they have drifted
  // apart once already — a `product-specification` tab address against a
  // `product` registry key, which resolved to nothing at all.
  basePath: '/catalog/product',
  icon: '▦',
  navLabelKey: 'shell:marketplaceAdmin.nav.products',
  // The one surface an organization is actually provisioned for. Brands and
  // categories are `catalog-reference`, which ADR 0022 makes permanently
  // non-grantable — a marketplace has to merge taxonomy, so no vendor buys it
  // and none may be refused it.
  entitled: true,
  service: 'marketplace-admin',
  searchProperty: 'name',
  labelProperty: 'name',
  sublabelProperty: 'code',
});

export const PRODUCT_OFFERING_SURFACE = catalogSurface(ProductOffering, {
  entityKey: 'product-offering',
  basePath: '/catalog/product-offering',
  icon: '◉',
  navLabelKey: 'shell:marketplaceAdmin.nav.offerings',
  // Tenant-plane and vendor-authored, exactly like the specification above, so
  // it carries the same ceiling: an organization provisioned for
  // `product-configuration-management` sees it and one provisioned for nothing
  // does not.
  entitled: true,
  service: 'marketplace-admin',
  searchProperty: 'name',
  labelProperty: 'name',
});

export const PRODUCT_OFFERING_PRICE_SURFACE = catalogSurface(
  ProductOfferingPrice,
  {
    entityKey: 'product-offering-price',
    basePath: '/catalog/product-offering-price',
    icon: '⊙',
    navLabelKey: 'shell:marketplaceAdmin.nav.offeringPrices',
    entitled: true,
    service: 'marketplace-admin',
    // ⚠️ `offeringId`, not `amount` or `currency`, and not by preference:
    // `defineRecordSearchSource` refuses a label member that is not sortable,
    // filterable **and** a string, at module load. `amount` is a number and
    // `currency` is not sortable, so this is the only member of this entity
    // that can name one of its own records.
    searchProperty: 'offeringId',
    labelProperty: 'offeringId',
    sublabelProperty: 'currency',
  },
);

export const PRODUCT_BRAND_SURFACE = catalogSurface(ProductBrand, {
  entityKey: 'product-brand',
  basePath: '/catalog/product-brand',
  icon: '◈',
  navLabelKey: 'shell:marketplaceAdmin.nav.brands',
  service: 'marketplace',
  searchProperty: 'name',
  labelProperty: 'name',
  sublabelProperty: 'code',
});

export const PRODUCT_CATEGORY_SURFACE = catalogSurface(ProductCategory, {
  entityKey: 'product-category',
  basePath: '/catalog/product-category',
  icon: '⊞',
  navLabelKey: 'shell:marketplaceAdmin.nav.categories',
  service: 'marketplace',
  searchProperty: 'name',
  labelProperty: 'name',
  sublabelProperty: 'code',
});

/**
 * Every catalog surface this shell contributes, in the order they appear.
 *
 * `DictionaryTerm` is deliberately absent though it is served from the same
 * place: the back office has no screen for it, so there is no `basePath` to
 * declare and both a nav entry and a search result would have nowhere to go.
 */
export const MARKETPLACE_ADMIN_CATALOG_SURFACES: readonly CatalogSurface[] = [
  PRODUCT_SURFACE,
  PRODUCT_OFFERING_SURFACE,
  PRODUCT_OFFERING_PRICE_SURFACE,
  PRODUCT_BRAND_SURFACE,
  PRODUCT_CATEGORY_SURFACE,
];
