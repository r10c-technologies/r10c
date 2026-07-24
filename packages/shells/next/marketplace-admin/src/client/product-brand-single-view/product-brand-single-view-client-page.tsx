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

export interface ProductBrandSingleViewClientPageProps {
  slug?: string;
  onSaved?: () => void;
  onDeleted?: () => void;
}

/** Composition root for a single product brand. Dual-host — see the product
 *  single view for how the optional props route it to a tab. */
export function ProductBrandSingleViewClientPage({
  slug,
  onSaved,
  onDeleted,
}: ProductBrandSingleViewClientPageProps = {}) {
  const { productBrandRest, configurationStore } = useMarketplaceAdminAdapters();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(slug ?? params.slug);

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

  const afterSave = onSaved ?? (() => router.push(LIST_HREF));
  const afterDelete = onDeleted ?? (() => router.push(LIST_HREF));

  const handleSave = async (brand: ProductBrand) => {
    if (await save(brand)) {
      afterSave();
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      afterDelete();
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
