'use client';

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
 * Unlike the list page this wires no link resolver: the form edits relations by
 * id, and both links expose their id whether or not the target was resolved. What
 * it does wire is a picker source per relation — the same base adapters pointed at
 * a different entity, handed over as use-cases rather than as loaded rows, so the
 * picker searches and pages the catalog instead of holding all of it.
 */
export function ProductSingleViewClientPage({
  slug,
  onSaved,
  onDeleted,
  initialDraft,
  onDraftChange,
}: ProductSingleViewClientPageProps = {}) {
  const { productRest, configurationStore } = useMarketplaceAdminAdapters();
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
      backHref={withLocale(LIST_HREF)}
      initialDraft={initialDraft}
      onDraftChange={onDraftChange}
    />
  );
}
