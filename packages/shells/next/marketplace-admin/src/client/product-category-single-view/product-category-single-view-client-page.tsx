'use client';

import { ProductCategory } from '@r10c/business-ts-catalog-reference';
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
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';
import { CATALOG_NEW_SLUG, slugToEntityId } from '../slug';

const LIST_HREF = '/catalog/product-category';

type CategoryContext = EntityRepositoryTag | ConfigurationRepositoryTag;

export interface ProductCategorySingleViewClientPageProps {
  slug?: string;
  onSaved?: () => void;
  onDeleted?: () => void;
}

/**
 * Composition root for a single product category: it picks the adapters, runs
 * the get/save/delete use-cases against them, and owns navigation. The form
 * organism stays unaware of all three. Dual-host via the optional props.
 */
export function ProductCategorySingleViewClientPage({
  slug,
  onSaved,
  onDeleted,
}: ProductCategorySingleViewClientPageProps = {}) {
  const { productCategoryRest, configurationStore } =
    useMarketplaceAdminAdapters();
  const router = useRouter();
  // Every internal navigation carries the locale. Unprefixed, each one is
  // bounced by the middleware — and the form's back link is a plain `<a>`,
  // so that redirect rides on top of a full document load.
  const withLocale = useLocaleHref();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(slug ?? params.slug);

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

  const afterSave = onSaved ?? (() => router.push(withLocale(LIST_HREF)));
  const afterDelete = onDeleted ?? (() => router.push(withLocale(LIST_HREF)));

  const handleSave = async (category: ProductCategory) => {
    const saved = await save(category);
    if (saved) {
      afterSave();
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      afterDelete();
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
      backHref={withLocale(LIST_HREF)}
    />
  );
}
