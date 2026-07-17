'use client';

import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  useDataLoading,
  useEntityMutation,
  useEntityRecord,
} from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  deleteUCFactory,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import { ProductForm } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';
import { CATALOG_NEW_SLUG, slugToEntityId } from '../slug';

const LIST_HREF = '/catalog/product';

/** How many brand/category options the relation pickers load. */
const RELATION_OPTIONS_LIMIT = 200;

type EntityContext = EntityRepositoryTag | ConfigurationRepositoryTag;

/**
 * Composition root for a single product.
 *
 * Unlike the list page this wires no link resolver: the form edits relations by
 * id, and both links expose their id whether or not the target was resolved. The
 * option lists come from the brand/category adapters instead — the same base
 * adapters, pointed at a different entity.
 */
export function ProductSingleViewClientPage() {
  const {
    productRest,
    productBrandRest,
    productCategoryRest,
    configurationStore,
  } = useMarketplaceAdminAdapters();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(params.slug);

  const ctx = Context.merge(configurationStore, productRest);
  const brandCtx = Context.merge(configurationStore, productBrandRest);
  const categoryCtx = Context.merge(configurationStore, productCategoryRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<Product, EntityContext>({
    uc: getUCFactory<Product>(),
    ctx,
    id,
  });

  // Relation pickers need the whole set, not the default first page of ten.
  // This ceiling is a stopgap: a picker that can't show every option is wrong,
  // and the real fix is a searchable/paged picker rather than a bigger number.
  const { items: brands } = useDataLoading<ProductBrand, EntityContext>({
    uc: loadUCFactory<ProductBrand>(),
    ctx: brandCtx,
    initialPageSize: RELATION_OPTIONS_LIMIT,
  });
  const { items: categories } = useDataLoading<ProductCategory, EntityContext>({
    uc: loadUCFactory<ProductCategory>(),
    ctx: categoryCtx,
    initialPageSize: RELATION_OPTIONS_LIMIT,
  });

  const {
    save,
    remove,
    isSaving,
    isDeleting,
    error: writeError,
  } = useEntityMutation<Product, EntityContext>({
    saveUc: saveUCFactory<Product>(),
    deleteUc: deleteUCFactory<Product>(),
    ctx,
  });

  const handleSave = async (product: Product) => {
    if (await save(product)) {
      router.push(LIST_HREF);
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      router.push(LIST_HREF);
    }
  };

  return (
    <ProductForm
      key={String(entity?.id ?? CATALOG_NEW_SLUG)}
      entity={entity}
      brands={brands}
      categories={categories}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={loadError ?? writeError}
      onSave={handleSave}
      onDelete={id == null ? undefined : handleDelete}
      backHref={LIST_HREF}
    />
  );
}
