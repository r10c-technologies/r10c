'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import type { FilterGroup } from '@entifix/core';
import { descendantsOf, hierarchyOf } from '@entifix/core';
import {
  type EntityCrudRelated,
  makeEntityCrud,
  useLocaleHref,
} from '@entifix/next-shell';
import {
  ButtonLink,
  EntityTableToolbar,
  useTranslateKey,
} from '@entifix/react-controls';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import {
  DeviceModel,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import {
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
} from '@r10c/business-ts-product-configuration-management';
import type { ReactNode } from 'react';

import {
  DEVICE_MODEL_SURFACE,
  PRODUCT_BRAND_SURFACE,
  PRODUCT_CATEGORY_SURFACE,
  PRODUCT_OFFERING_PRICE_SURFACE,
  PRODUCT_OFFERING_SURFACE,
  PRODUCT_SURFACE,
} from '../catalog-surfaces';
import { PRODUCT_SETUP_SURFACE } from '../wizard-surfaces';
import type { MarketplaceAdminAdapters } from './client-types';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';
import {
  OFFERING_RELATED_COLUMNS,
  OfferingImagesRegion,
} from './offering-regions';

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

/** The phones a product can fit — operator vocabulary, like a brand. */
export const deviceModelCrud = makeEntityCrud(DeviceModel, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: DEVICE_MODEL_SURFACE.basePath,
  catalogKey: DEVICE_MODEL_SURFACE.entityKey,
  repository: 'deviceModelRest',
  write: 'deviceModelWriter',
  hiddenFields: ['id', 'code'],
  metadata: 'referenceMetadata',
  useCases: 'deviceModelUseCases',
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
  // `fitsDeviceModelIds` is edited by the guided alta's own picker: entifix has
  // no control for a list of ids into another record, and the generic form
  // would offer a text box of raw ids. Hidden keeps it in the draft, so an
  // update carries it back unchanged.
  // The lifecycle members are the verbs' (ADR 0079 §1): `release`, `revise`,
  // `retire` and `obsolete` move them and the write path restores them from
  // what is stored, so an input for any of them would be a lie about who
  // decides it. They stay legible as list columns and in which verb the form
  // header offers.
  hiddenFields: [
    'id',
    'code',
    'fitsDeviceModelIds',
    'specKey',
    'version',
    'lifecycleStatus',
    'validFrom',
    'validTo',
    'contentHash',
  ],
  // Without these two the form offers none of a version's four verbs.
  metadata: 'catalogMetadata',
  useCases: 'productUseCases',
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
  /**
   * The specification's offerings, and the way to offer it (#564): the
   * region's "New" opens an offering create with this specification already
   * chosen. The product-setup wizard hands off here, because what it creates
   * is a specification — the offering is the next step, not one it took.
   */
  regions: specification => [
    <productOfferingCrud.RelatedList
      key="offerings"
      labelKey="r10c:marketplaceAdmin.product.regions.offerings"
      filtering={{
        operator: 'and',
        values: [
          {
            property: 'specificationId',
            operator: 'eq',
            value: String(specification.id),
          },
        ],
      }}
      prefill={{ specificationId: String(specification.id) }}
    />,
  ],
});

/**
 * What a host adds to the offering's page from **other** slices (ADR 0077 §2):
 * a related column read through another shell's adapter, and regions another
 * shell renders. Only the host composes them; this shell never imports
 * another shell.
 */
export interface ProductOfferingCrudWith {
  readonly related?: readonly EntityCrudRelated<MarketplaceAdminAdapters>[];
  readonly regions?: (offering: ProductOffering) => readonly ReactNode[];
}

/**
 * The offering's screens (#558, #564): its list with a price and a picture per
 * row, and its page with its pictures and prices under the form — each region
 * reading and writing through its own service, and only the form autosaving.
 *
 * Called with nothing it is this slice's page alone; the back office passes
 * the stock held of the offering, which lives in another slice.
 */
export const productOfferingCrudWith = ({
  related = [],
  regions,
}: ProductOfferingCrudWith = {}) =>
  makeEntityCrud(ProductOffering, {
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
    // `saleUnit` too (ADR 0082 §3): only `set-sale-unit` changes it, and the
    // save carries the stored unit across, so an input here would offer a
    // choice the write ignores. The step and minimum stay, read in its scale.
    hiddenFields: ['id', 'status', 'statusChangedAt', 'saleUnit'],
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
    related: [...OFFERING_RELATED_COLUMNS, ...related],
    regions: offering => [
      <OfferingImagesRegion key="images" offering={offering} />,
      <productOfferingPriceCrud.RelatedList
        key="prices"
        labelKey="r10c:marketplaceAdmin.offering.regions.prices"
        filtering={{
          operator: 'and',
          values: [
            {
              property: 'offeringId',
              operator: 'eq',
              value: String(offering.id),
            },
          ],
        }}
        prefill={{ offeringId: String(offering.id) }}
      />,
      ...(regions?.(offering) ?? []),
    ],
  });

export const productOfferingCrud = productOfferingCrudWith();

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

export const DeviceModelListClientPage = deviceModelCrud.ListPage;
export const DeviceModelSingleViewClientPage = deviceModelCrud.SingleViewPage;
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
 * Each keeps its concrete entity type: since entifix 0.21.0 a crud's
 * `RelatedList` is typed by its own entity, so `EntityCrud<T>` is invariant and
 * erasing to `EntityCrud<Entity>` would not type. A consumer that walks the list
 * reads only the members every crud shares.
 */
export const MARKETPLACE_ADMIN_CRUDS = [
  productCrud,
  productOfferingCrud,
  productOfferingPriceCrud,
  productBrandCrud,
  productCategoryCrud,
  deviceModelCrud,
] as const;
