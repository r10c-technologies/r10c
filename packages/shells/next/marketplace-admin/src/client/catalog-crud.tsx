'use client';

import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  ButtonLink,
  EntityColumn,
  EntityTableToolbar,
  useTranslateKey,
} from '@r10c/entifix-react-controls';
import type {
  BulkOutcome,
  Entity,
  EntitySelection,
} from '@r10c/entifix-ts-core';
import { toWireSelection } from '@r10c/entifix-ts-core';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrud } from '@r10c/shells-next-common';
import { makeEntityCrud, useLocaleHref } from '@r10c/shells-next-common';

import {
  PRODUCT_BRAND_SURFACE,
  PRODUCT_CATEGORY_SURFACE,
  PRODUCT_SURFACE,
} from '../catalog-surfaces';
import { PRODUCT_SETUP_SURFACE } from '../wizard-surfaces';
import { useMarketplaceAdminAdapters } from './marketplace-admin-context';

/**
 * The catalog's three CRUD surfaces, declared rather than written.
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
 * The reference vocabulary's affordances and bulk verbs, both through the
 * host's own `/api/marketplace` proxy.
 *
 * A hand-written path rather than the adapters' config-driven `compose` mode,
 * for the same reason the auth shell writes one: these are not entity CRUD
 * calls, so they do not go through `buildEntityRestAdapter*` and there is no
 * `uri` group for them to compose from. The proxy is what keeps a real backend
 * address out of the browser, and what carries the httpOnly cookie upstream —
 * a cross-origin call would answer `401`.
 */
const REFERENCE_METADATA = makeEntityMetadataSource({
  url: name => `/api/marketplace/${name}/$metadata`,
});

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
  configuration: 'configurationStore',
  // `code` is assigned by the create transaction. Hiding it keeps it out of the
  // form without keeping it out of the draft, so an update carries it back.
  hiddenFields: ['id', 'code'],
  metadataSource: REFERENCE_METADATA,
  runBulkUseCase: runReferenceBulk(PRODUCT_BRAND_SURFACE.entityKey),
});

export const productCategoryCrud = makeEntityCrud(ProductCategory, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_CATEGORY_SURFACE.basePath,
  catalogKey: PRODUCT_CATEGORY_SURFACE.entityKey,
  repository: 'productCategoryRest',
  configuration: 'configurationStore',
  hiddenFields: ['id'],
  metadataSource: REFERENCE_METADATA,
  runBulkUseCase: runReferenceBulk(PRODUCT_CATEGORY_SURFACE.entityKey),
});

/**
 * A `ButtonLink` and not a `Button`, because the click is a navigation: it keeps
 * middle-click, open-in-new-tab and the status bar, and costs no client
 * boundary of its own. `useLocaleHref` because every internal href carries the
 * locale — an unprefixed one still resolves through the middleware, at the cost
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
      {translateKey('shell:marketplaceAdmin.wizard.productSetup.launch')}
    </ButtonLink>
  );
}

export const productCrud = makeEntityCrud(ProductSpecification, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: PRODUCT_SURFACE.basePath,
  catalogKey: PRODUCT_SURFACE.entityKey,
  repository: 'productRest',
  configuration: 'configurationStore',
  hiddenFields: ['id'],
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

export const ProductBrandListClientPage = productBrandCrud.ListPage;
export const ProductBrandSingleViewClientPage = productBrandCrud.SingleViewPage;
export const ProductCategoryListClientPage = productCategoryCrud.ListPage;
export const ProductCategorySingleViewClientPage =
  productCategoryCrud.SingleViewPage;
export const ProductListClientPage = productCrud.ListPage;
export const ProductSingleViewClientPage = productCrud.SingleViewPage;

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
  productBrandCrud,
  productCategoryCrud,
] as readonly EntityCrud<Entity>[];
