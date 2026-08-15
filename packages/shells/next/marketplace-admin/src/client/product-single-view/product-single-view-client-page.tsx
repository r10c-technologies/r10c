'use client';

import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
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
import {
  ProductForm,
  type ProductFormDraft,
} from '@r10c/implementation-product-configuration-management-react';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';
import { CATALOG_NEW_SLUG, slugToEntityId } from '../slug';

const LIST_HREF = '/catalog/product';

type EntityContext = EntityRepositoryTag | ConfigurationRepositoryTag;

export interface ProductSingleViewClientPageProps {
  /** The record slug. Defaults to the route param, so a plain route needs no
   *  props; the workspace tab host passes it explicitly. */
  slug?: string;
  /** Runs after a successful save/delete. Defaults to returning to the list
   *  route; the tab host overrides it to stay in the workspace. */
  onSaved?: () => void;
  onDeleted?: () => void;
  /** Seed the form from a persisted draft (workspace autosave). */
  initialDraft?: ProductFormDraft;
  /** Called on every field edit so the host can autosave a draft. */
  onDraftChange?: (draft: ProductFormDraft) => void;
}

/**
 * Composition root for a single product. Dual-host: rendered as a route it reads
 * its slug from the URL and returns to the list on save; rendered in a workspace
 * tab it takes the slug and post-save action as props.
 *
 * Unlike the list page this wires no link resolver: the form edits both
 * classifications by id, and holds that id whether or not the target resolves.
 * What it does wire is a picker source per classification — handed over as
 * use-cases rather than as loaded rows, so the picker searches and pages the
 * catalog instead of holding all of it.
 *
 * Those two sources point at a **different service** than the record itself.
 * `ProductSpecification` is tenant-plane and comes from marketplace-admin-service
 * through `productRest`; `ProductBrand` and `ProductCategory` are the
 * platform-plane vocabulary in `catalog-reference`, so they come from
 * marketplace-service through `productBrandRest`/`productCategoryRest`
 * (ADR 0022). Resolving an id therefore goes through the owning domain's own
 * read path, which is the only legal way across a store boundary — never a join.
 */
export function ProductSingleViewClientPage({
  slug,
  onSaved,
  onDeleted,
  initialDraft,
  onDraftChange,
}: ProductSingleViewClientPageProps = {}) {
  const {
    productRest,
    productBrandRest,
    productCategoryRest,
    configurationStore,
  } = useMarketplaceAdminAdapters();
  const router = useRouter();
  // Every internal navigation carries the locale. Unprefixed, each one is
  // bounced by the middleware — and the form's back link is a plain `<a>`,
  // so that redirect rides on top of a full document load.
  const withLocale = useLocaleHref();
  const params = useParams<{ slug: string }>();
  const id = slugToEntityId(slug ?? params.slug);

  const ctx = Context.merge(configurationStore, productRest);

  const {
    entity,
    isLoading,
    error: loadError,
  } = useEntityRecord<ProductSpecification, EntityContext>({
    uc: getUCFactory<ProductSpecification>(),
    ctx,
    id,
  });

  const {
    save,
    remove,
    isSaving,
    isDeleting,
    error: writeError,
  } = useEntityMutation<ProductSpecification, EntityContext>({
    saveUc: saveUCFactory<ProductSpecification>(),
    deleteUc: deleteUCFactory<ProductSpecification>(),
    ctx,
  });

  const afterSave = onSaved ?? (() => router.push(withLocale(LIST_HREF)));
  const afterDelete = onDeleted ?? (() => router.push(withLocale(LIST_HREF)));

  const handleSave = async (product: ProductSpecification) => {
    if (await save(product)) {
      afterSave();
    }
  };

  const handleDelete = async () => {
    if (await remove(id)) {
      afterDelete();
    }
  };

  return (
    <ProductForm
      key={String(entity?.id ?? CATALOG_NEW_SLUG)}
      entity={entity}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={loadError ?? writeError}
      onSave={handleSave}
      onDelete={id == null ? undefined : handleDelete}
      // Rebuilt inline on every render on purpose: `useEntityLinkSource` holds
      // these in a ref and keeps them out of its query keys, precisely so a
      // caller does not have to memoise them.
      brandLink={{
        entityConstructor: ProductBrand,
        loadUc: loadUCFactory<ProductBrand>(),
        getUc: getUCFactory<ProductBrand>(),
        ctx: Context.merge(configurationStore, productBrandRest),
      }}
      categoryLink={{
        entityConstructor: ProductCategory,
        loadUc: loadUCFactory<ProductCategory>(),
        getUc: getUCFactory<ProductCategory>(),
        ctx: Context.merge(configurationStore, productCategoryRest),
      }}
      backHref={withLocale(LIST_HREF)}
      initialDraft={initialDraft}
      onDraftChange={onDraftChange}
    />
  );
}
