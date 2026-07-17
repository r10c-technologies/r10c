'use client';

import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
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
import { ProductBrandForm } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';
import { CATALOG_NEW_SLUG, slugToEntityId } from '../slug';

const LIST_HREF = '/catalog/product-brand';

type BrandContext = EntityRepositoryTag | ConfigurationRepositoryTag;

/** Composition root for a single product brand. */
export function ProductBrandSingleViewClientPage() {
  const { productBrandRest, configurationStore } = useMarketplaceAdminAdapters();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(params.slug);

  const ctx = Context.merge(configurationStore, productBrandRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<ProductBrand, BrandContext>({
    uc: getUCFactory<ProductBrand>(),
    ctx,
    id,
  });

  const {
    save,
    remove,
    isSaving,
    isDeleting,
    error: writeError,
  } = useEntityMutation<ProductBrand, BrandContext>({
    saveUc: saveUCFactory<ProductBrand>(),
    deleteUc: deleteUCFactory<ProductBrand>(),
    ctx,
  });

  const handleSave = async (brand: ProductBrand) => {
    if (await save(brand)) {
      router.push(LIST_HREF);
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      router.push(LIST_HREF);
    }
  };

  return (
    <ProductBrandForm
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
