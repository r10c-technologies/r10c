'use client';

import { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import {
  useEntityMutation,
  useEntityRecord,
} from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  deleteUCFactory,
  EntityRepositoryTag,
  getUCFactory,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import { ProductCategoryForm } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';
import { CATALOG_NEW_SLUG, slugToEntityId } from '../slug';

const LIST_HREF = '/catalog/product-category';

type CategoryContext = EntityRepositoryTag | ConfigurationRepositoryTag;

/**
 * Composition root for a single product category: it picks the adapters, runs
 * the get/save/delete use-cases against them, and owns navigation. The form
 * organism stays unaware of all three.
 */
export function ProductCategorySingleViewClientPage() {
  const { productCategoryRest, configurationStore } =
    useMarketplaceAdminAdapters();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(params.slug);

  const ctx = Context.merge(configurationStore, productCategoryRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<ProductCategory, CategoryContext>({
    uc: getUCFactory<ProductCategory>(),
    ctx,
    id,
  });

  const {
    save,
    remove,
    isSaving,
    isDeleting,
    error: writeError,
  } = useEntityMutation<ProductCategory, CategoryContext>({
    saveUc: saveUCFactory<ProductCategory>(),
    deleteUc: deleteUCFactory<ProductCategory>(),
    ctx,
  });

  const handleSave = async (category: ProductCategory) => {
    const saved = await save(category);
    if (saved) {
      router.push(LIST_HREF);
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      router.push(LIST_HREF);
    }
  };

  return (
    <ProductCategoryForm
      // Remounts (and reseeds the fields) once the record arrives.
      key={String(entity?.id ?? CATALOG_NEW_SLUG)}
      entity={entity}
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
