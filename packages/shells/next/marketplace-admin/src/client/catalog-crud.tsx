'use client';

import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntityColumn } from '@r10c/entifix-react-controls';
import type {
  BulkOutcome,
  Entity,
  EntitySelection,
} from '@r10c/entifix-ts-core';
import { toWireSelection } from '@r10c/entifix-ts-core';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import { makeEntityCrud } from '@r10c/shells-next-common';

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
  basePath: '/catalog/product-brand',
  catalogKey: 'product-brand',
  repository: 'productBrandRest',
  configuration: 'configurationStore',
  // `code` is assigned by the create transaction. Hiding it keeps it out of the
  // form without keeping it out of the draft, so an update carries it back.
  hiddenFields: ['id', 'code'],
  metadataSource: REFERENCE_METADATA,
  runBulkUseCase: runReferenceBulk('product-brand'),
});

export const productCategoryCrud = makeEntityCrud(ProductCategory, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: '/catalog/product-category',
  catalogKey: 'product-category',
  repository: 'productCategoryRest',
  configuration: 'configurationStore',
  hiddenFields: ['id'],
  metadataSource: REFERENCE_METADATA,
  runBulkUseCase: runReferenceBulk('product-category'),
});

export const productCrud = makeEntityCrud(ProductSpecification, {
  useAdapters: useMarketplaceAdminAdapters,
  basePath: '/catalog/product',
  catalogKey: 'product-specification',
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
