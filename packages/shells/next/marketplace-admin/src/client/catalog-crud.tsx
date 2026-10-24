'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import type {
  BulkOutcome,
  Entity,
  EntityId,
  EntitySelection,
  FilterGroup,
} from '@entifix/core';
import {
  descendantsOf,
  EntifixLogicError,
  hierarchyOf,
  toWireSelection,
} from '@entifix/core';
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
/**
 * Runs a `collection`-bound verb on the reference service.
 *
 * The selection goes over the wire in its **array** form: a `Set` serializes to
 * `{}`, so a `matching` selection sent raw would arrive with its exclusions
 * silently gone and act on rows the operator had deliberately taken out.
 *
 * `key` is the verb's own key, which is also the route — `retire` posts to
 * `…/retire`. That holds only while a verb's key and its path agree, which is
 * the convention here and is asserted by nothing; a verb whose route differs
 * would need a map, and the honest place for it is this function.
 */
export const runReferenceBulk =
  (entityName: string) =>
  async <TEntity extends Entity>(
    key: string,
    selection: EntitySelection<TEntity>,
  ): Promise<readonly BulkOutcome[]> => {
    const response = await fetch(`/api/marketplace/${entityName}/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selection: toWireSelection(selection) }),
    });

    if (!response.ok) {
      // Thrown rather than returned as outcomes: the *request* failed, which is
      // not something any individual row did. `useEntityBulk` catches it and
      // attributes it across the selected rows.
      throw new Error(`bulk ${key} failed with ${response.status}`);
    }

    const body = (await response.json()) as { data?: BulkOutcome[] };
    return body.data ?? [];
  };

export const productBrandCrud = makeEntityCrud(ProductBrand, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_BRAND_SURFACE.basePath,
  catalogKey: PRODUCT_BRAND_SURFACE.entityKey,
  repository: 'productBrandRest',
  // `code` is assigned by the create transaction. Hiding it keeps it out of the
  // form without keeping it out of the draft, so an update carries it back.
  hiddenFields: ['id', 'code'],
  metadata: 'referenceMetadata',
  runBulkUseCase: runReferenceBulk(PRODUCT_BRAND_SURFACE.entityKey),
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
  hiddenFields: ['id'],
  metadata: 'referenceMetadata',
  runBulkUseCase: runReferenceBulk(PRODUCT_CATEGORY_SURFACE.entityKey),
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
  // `code` is assigned by the create transaction, the same as `ProductBrand`'s.
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

/**
 * Runs an `entity`-bound verb on one record of the catalog service.
 *
 * `key` is also the route — `publish` posts to `…/<id>/publish` — which holds
 * only while a verb's key and its path agree. That is the convention here and
 * nothing asserts it; a verb whose route differed would need a map, and this
 * function is the honest place for it.
 *
 * A failed request **throws**, so the form's error slot renders it: a `409`
 * from an illegal transition carries a `code` the shared `errors` catalog
 * resolves, and swallowing it would leave the operator looking at a button that
 * did nothing.
 */
export const runCatalogUseCase =
  (entityName: string) => async (key: string, id: EntityId) => {
    // `String(id)`: `EntityId` admits a symbol, which interpolates to a
    // runtime throw rather than a compile error in a template literal.
    const response = await fetch(
      `/api/admin/${entityName}/${String(id)}/${key}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      // An `EntifixError` carrying the service's `code` in `details`, because
      // that is exactly what `useErrorMessage` resolves through the shared
      // `errors` catalog — a bare `Error` would render its own message, which is
      // an English sentence nobody wrote for a user to read.
      throw new EntifixLogicError(body.error ?? `${key} failed`, undefined, {
        code: body.code ?? 'unexpected',
      });
    }
  };

/**
 * Runs a `collection`-bound catalog verb over a selection.
 *
 * The twin of {@link runCatalogUseCase}, one level up the path: a record's verb
 * is `/<entity>/<id>/<key>` and a collection's is `/<entity>/<key>`.
 *
 * ⚠️ **Throws on a non-2xx rather than returning outcomes**, which is what lets
 * `useEntityBulk` attribute a whole failed request across the ticked rows. A
 * per-row refusal is not that: it comes back `200` in `data`, because the
 * request succeeded and only some of the rows did not.
 */
export const runCatalogBulk =
  (entityName: string) =>
  async <TEntity extends Entity>(
    key: string,
    selection: EntitySelection<TEntity>,
  ): Promise<readonly BulkOutcome[]> => {
    const response = await fetch(`/api/admin/${entityName}/${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ selection: toWireSelection(selection) }),
    });
    const body = (await response.json()) as {
      data?: readonly BulkOutcome[];
      error?: string;
      code?: string;
    };
    if (!response.ok) {
      throw new EntifixLogicError(
        body.error ?? 'bulk request failed',
        undefined,
        {
          code: body.code ?? 'unexpected',
        },
      );
    }
    return body.data ?? [];
  };

export const productOfferingCrud = makeEntityCrud(ProductOffering, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_OFFERING_SURFACE.basePath,
  catalogKey: PRODUCT_OFFERING_SURFACE.entityKey,
  repository: 'productOfferingRest',
  // Without these two the form renders `publish`/`unpublish` nowhere: absent
  // metadata keeps the pre-ADR-0026 behaviour, and a metadata source with no
  // handler renders buttons that do nothing.
  metadata: 'catalogMetadata',
  runUseCase: runCatalogUseCase(PRODUCT_OFFERING_SURFACE.entityKey),
  // The same two verbs over a selection (#216). The route is the verb key on
  // the collection rather than on a record — `/api/admin/product-offering/publish`
  // — which is the convention `runCatalogUseCase` above already follows one
  // level down, and which nothing asserts.
  runBulkUseCase: runCatalogBulk(PRODUCT_OFFERING_SURFACE.entityKey),
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
