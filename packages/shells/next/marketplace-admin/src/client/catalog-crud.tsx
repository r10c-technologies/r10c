'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import type { Entity, FilterGroup } from '@entifix/core';
import { descendantsOf, hierarchyOf } from '@entifix/core';
import type { EntityCrud } from '@entifix/next-shell';
import { makeEntityCrud, useLocaleHref } from '@entifix/next-shell';
import {
  ButtonLink,
  EntityColumn,
  EntityTableToolbar,
  useTranslateKey,
} from '@entifix/react-controls';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';

import {
  PRODUCT_BRAND_SURFACE,
  PRODUCT_CATEGORY_SURFACE,
  PRODUCT_OFFERING_PRICE_SURFACE,
  PRODUCT_OFFERING_SURFACE,
  PRODUCT_SURFACE,
} from '../catalog-surfaces';
import { PRODUCT_SETUP_SURFACE } from '../wizard-surfaces';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/**
 * The catalog's five CRUD surfaces, declared rather than written.
 *
 * Each of these used to be ~10 files and ~300 lines whose only variable was the
 * class name: a table organism and a form organism with a `.types.ts` each, a
 * list client page, a single-view client page. `makeEntityCrud` derives all of
 * it from the entity's own accessor metadata; what stays here is the six facts
 * metadata cannot know — the route, the catalog key, which adapter answers for
 * the record, what the form hides, and where a picker looks.
 *
 * The pickers point at a **different service** than the record they hang off.
 * `ProductSpecification` is tenant-plane and comes from marketplace-admin-service
 * through `productRest`; `ProductBrand` and `ProductCategory` are the
 * platform-plane vocabulary in `catalog-reference`, so they come from
 * marketplace-service through `productBrandRest`/`productCategoryRest`
 * (ADR 0022). Resolving an id therefore goes through the owning domain's own
 * read path, which is the only legal way across a store boundary — never a join.
 */
export const productBrandCrud = makeEntityCrud(ProductBrand, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_BRAND_SURFACE.basePath,
  catalogKey: PRODUCT_BRAND_SURFACE.entityKey,
  repository: 'productBrandRest',
  write: 'productBrandWriter',
  // `code` is the seed's vocabulary, not the operator's to type. Hiding it keeps
  // it out of the form without keeping it out of the draft, so an update
  // carries it back.
  hiddenFields: ['id', 'code'],
  metadata: 'referenceMetadata',
  useCases: 'productBrandUseCases',
});

/**
 * How many categories one page of the list holds — and so how many the parent
 * picker reads to find a category's subtree. ADR 0062 caps the tree at five
 * levels, and a vocabulary past this size wants a server-side subtree query
 * rather than a bigger page.
 */
const CATEGORY_PAGE_SIZE = 200;

/** Read once: `ProductCategory` declares `parentId` its parent. */
const categoryTree = hierarchyOf(ProductCategory);

/**
 * What a category's parent picker may not offer: the category itself and every
 * category beneath it, either of which would make the tree a cycle.
 *
 * A hook because the subtree is other records. It reads the same page the list
 * asks for, under the same query key, and restricts nothing until that page
 * arrives, or on a create, which has no subtree yet. The service still refuses
 * a cycle with `409 categoryCycle`; this keeps the picker from offering one.
 */
const useOutsideOwnSubtree = (
  category: ProductCategory | undefined,
): FilterGroup<ProductCategory> | undefined => {
  const { items } = useDataLoading<ProductCategory, EntityRepositoryTag>({
    uc: loadUCFactory<ProductCategory>(),
    ctx: useMarketplaceAdminAdapters().productCategoryRest,
    initialPageSize: CATEGORY_PAGE_SIZE,
    queryKey: entityQueryScope(ProductCategory),
    enabled: category?.id != null,
  });
  if (category?.id == null || categoryTree === undefined) return undefined;
  const own = String(category.id);
  return {
    operator: 'and',
    values: [
      {
        property: 'id',
        operator: 'nin',
        values: [own, ...descendantsOf(items, categoryTree, own)],
      },
    ],
  };
};

export const productCategoryCrud = makeEntityCrud(ProductCategory, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_CATEGORY_SURFACE.basePath,
  catalogKey: PRODUCT_CATEGORY_SURFACE.entityKey,
  repository: 'productCategoryRest',
  write: 'productCategoryWriter',
  hiddenFields: ['id'],
  metadata: 'referenceMetadata',
  useCases: 'productCategoryUseCases',
  // One page holds the whole tree, so the list renders every level of it.
  pageSize: CATEGORY_PAGE_SIZE,
  // The parent is another category in the same store (ADR 0062), chosen with
  // the same picker a specification's classification uses. The list renders
  // as a tree on its own, because the entity declares `parentId` its parent.
  links: [
    {
      field: 'parentId',
      entityConstructor: ProductCategory,
      repository: 'productCategoryRest',
      labelProperty: 'name',
      searchProperty: 'name',
      useBaseFiltering: useOutsideOwnSubtree,
    },
  ],
});

/**
 * A `ButtonLink` and not a `Button`, because the click is a navigation: it keeps
 * middle-click, open-in-new-tab and the status bar, and costs no client
 * boundary of its own. `useLocaleHref` because every internal href carries the
 * locale — an unprefixed one still resolves through the proxy, at the cost
 * of a round trip per click.
 */
function ProductSetupLink() {
  const translateKey = useTranslateKey();
  const withLocale = useLocaleHref();

  return (
    <ButtonLink
      variant="secondary"
      size="sm"
      href={withLocale(PRODUCT_SETUP_SURFACE.basePath)}
    >
      {translateKey('r10c:marketplaceAdmin.wizard.productSetup.launch')}
    </ButtonLink>
  );
}

export const productCrud = makeEntityCrud(ProductSpecification, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_SURFACE.basePath,
  catalogKey: PRODUCT_SURFACE.entityKey,
  repository: 'productRest',
  write: 'productWriter',
  // `code` is drawn by the create from the organization's counter.
  // Hiding it keeps it out of the form without keeping it out of the draft, so
  // an update carries it back — and the operator is not asked to type a value
  // the service overwrites.
  hiddenFields: ['id', 'code'],
  // `brandId` keeps an override, which is still the escape hatch for a column
  // whose presentation the metadata cannot express — it renders an em dash
  // rather than an empty cell when the classification is unset.
  columns: (
    <EntityColumn<ProductSpecification>
      field="brandId"
      render={product => (
        <span className="font-medium">{product.brandId ?? '—'}</span>
      )}
    />
  ),
  /**
   * The way into the guided alta, from the list it starts from.
   *
   * [ADR 0033](../../../../../../docs/adr/0033-the-screen-taxonomy.md) records
   * the cost of a type-first sidebar — an asistente sits far from the
   * definiciones it operates on — and names this as the mitigation: the wizard
   * is reachable from the record list it begins at, rather than gaining a second
   * nav placement.
   *
   * A link and **not** a `@useCase()` verb: every one of ADR 0035's nine cells
   * resolves to an action on records, and the only handler a
   * `collection:context-independent` verb reaches is `onBulkUseCase`, whose
   * contract is per-row outcomes. A launcher acts on no rows at all.
   */
  toolbar: (
    <EntityTableToolbar>
      <ProductSetupLink />
    </EntityTableToolbar>
  ),
  // `brandId`/`categoryId` are plain `string` members, not `link`s: a typed
  // relation into another slice's store is neither a legal import nor a join we
  // would want. The picker writes the target's id straight into the draft and
  // `applyEntityLinks` skips a non-`link` descriptor, so the id stays the truth.
  //
  // The two target properties are stated rather than defaulted. A real `link`'s
  // accessor knows its target and can carry them; a scalar id's cannot, because
  // `ProductSpecification` may not import `catalog-reference` — that is the
  // whole point of ADR 0022 — so the fact lives at the only place that already
  // names the target type.
  links: [
    {
      field: 'brandId',
      entityConstructor: ProductBrand,
      repository: 'productBrandRest',
      labelProperty: 'name',
      searchProperty: 'name',
    },
    {
      field: 'categoryId',
      entityConstructor: ProductCategory,
      repository: 'productCategoryRest',
      labelProperty: 'name',
      searchProperty: 'name',
    },
  ],
});

export const productOfferingCrud = makeEntityCrud(ProductOffering, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_OFFERING_SURFACE.basePath,
  catalogKey: PRODUCT_OFFERING_SURFACE.entityKey,
  repository: 'productOfferingRest',
  write: 'productOfferingWriter',
  // Without these two the form renders `publish`/`unpublish` nowhere: absent
  // metadata keeps the pre-ADR-0026 behaviour, and a metadata source with no
  // handler renders buttons that do nothing.
  metadata: 'catalogMetadata',
  useCases: 'productOfferingUseCases',
  // ⚠️ `status` is hidden because it is **not the vendor's to write**. The two
  // verbs own it, the write path overwrites whatever the form sends
  // (`preserveOfferingLifecycle`), and asking the operator for it made a required
  // field out of a value they do not control — measured: a create blocked on
  // "Status is required" for a member that has a default and is server-owned.
  // The state stays legible on the list column and through which verb the form
  // offers; the field itself would be a lie about who decides it.
  // `statusChangedAt` joins them for the same reason and one more: it is the
  // moment the rebuild walk re-announces from, so an operator editing it would
  // silently move an offering's place in the projection's ordering.
  hiddenFields: ['id', 'status', 'statusChangedAt'],
  // `specificationId` is a plain `string` into the same store, and the picker
  // treats it exactly as it treats a cross-store id: `PICKABLE_TYPES` admits
  // `link` and `string`, and `applyEntityLinks` skips a non-`link` descriptor,
  // so the id stays the truth and the wrapper reconstructs from the draft.
  //
  // Both target properties are stated rather than defaulted, for the reason
  // `ProductSpecification` states its own: a scalar id's accessor cannot name
  // the target's members, and the default is `'name'` whether or not the target
  // has one.
  links: [
    {
      field: 'specificationId',
      entityConstructor: ProductSpecification,
      repository: 'productRest',
      labelProperty: 'name',
      searchProperty: 'name',
    },
  ],
});

export const productOfferingPriceCrud = makeEntityCrud(ProductOfferingPrice, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_OFFERING_PRICE_SURFACE.basePath,
  catalogKey: PRODUCT_OFFERING_PRICE_SURFACE.entityKey,
  repository: 'productOfferingPriceRest',
  write: 'productOfferingPriceWriter',
  hiddenFields: ['id'],
  links: [
    {
      field: 'offeringId',
      entityConstructor: ProductOffering,
      repository: 'productOfferingRest',
      labelProperty: 'name',
      searchProperty: 'name',
    },
  ],
});

export const ProductBrandListClientPage = productBrandCrud.ListPage;
export const ProductBrandSingleViewClientPage = productBrandCrud.SingleViewPage;
export const ProductCategoryListClientPage = productCategoryCrud.ListPage;
export const ProductCategorySingleViewClientPage =
  productCategoryCrud.SingleViewPage;
export const ProductListClientPage = productCrud.ListPage;
export const ProductSingleViewClientPage = productCrud.SingleViewPage;
export const ProductOfferingListClientPage = productOfferingCrud.ListPage;
export const ProductOfferingSingleViewClientPage =
  productOfferingCrud.SingleViewPage;
export const ProductOfferingPriceListClientPage =
  productOfferingPriceCrud.ListPage;
export const ProductOfferingPriceSingleViewClientPage =
  productOfferingPriceCrud.SingleViewPage;

/**
 * The catalog's generated screens, as a list the workspace registry walks.
 *
 * The six named re-exports above are the **routes'** entry points — a Next page
 * file imports one by name — and stay. This is the other consumer: a registry
 * that used to restate all three keys and both page components by hand, once per
 * map, and silently served nothing for a key it had missed.
 *
 * `EntityCrud<Entity>` erases the three concrete entity types. The factory
 * cannot preserve one type parameter per surface across a heterogeneous list,
 * and nothing downstream needs it — the registry renders components and titles
 * tabs; it never touches an instance. `AnyEntityLinkSourceConfig` erases for the
 * same reason one layer down.
 */
export const MARKETPLACE_ADMIN_CRUDS: readonly EntityCrud<Entity>[] = [
  productCrud,
  productOfferingCrud,
  productOfferingPriceCrud,
  productBrandCrud,
  productCategoryCrud,
] as readonly EntityCrud<Entity>[];
