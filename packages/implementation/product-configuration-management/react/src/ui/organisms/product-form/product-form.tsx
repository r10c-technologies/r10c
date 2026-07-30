'use client';

import {
  Product,
  type ProductBrand,
  type ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import {
  useEntityForm,
  useEntityLinkSource,
} from '@r10c/entifix-react-integration';
import { applyEntityLinks, describeEntityColumns } from '@r10c/entifix-ts-core';
import { useEffect, useMemo } from 'react';

import type { ProductFormProps } from './product-form.types';

/**
 * Create/update form for a {@link Product}. A thin wrapper over the agnostic
 * {@link EntityForm}: the generic form builds every field from metadata —
 * relations included, now that it can be handed a picker source — and this
 * wrapper only supplies the two sources and the draft→`Product` reconstruction.
 *
 * Neither half is domain-specific any more. `applyEntityLinks` writes each
 * relation the way the *entity* declares it (`brand` embedded, `category` as a
 * foreign key), so that difference lives on `Product` rather than here, and the
 * hook's `links` carries the picked instances the embedded shape needs.
 *
 * One `useEntityLinkSource` call per relation, because React's hook count has to
 * stay fixed and the agnostic controls package may not reach the integration
 * layer to make the call itself.
 */
export function ProductForm<TContext>({
  entity,
  brandLink,
  categoryLink,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  onSave,
  onDelete,
  backHref,
  initialDraft,
  onDraftChange,
}: ProductFormProps<TContext>) {
  const et = useT('entity');
  const descriptors = useMemo(
    () => describeEntityColumns(Product, entity),
    [entity],
  );

  const form = useEntityForm<Product>({
    entityConstructor: Product,
    entity,
    initialValues: initialDraft,
    onSubmit: values => {
      const product = new Product(values.code, values.name);
      product.id = entity?.id;
      product.description =
        values.description === '' ? undefined : values.description;
      applyEntityLinks(product, descriptors, values, form.links);

      onSave(product);
    },
  });

  // The selection sidecar is keyed by field name and holds bare `Entity`, so the
  // target type is restated here — the accessor's own type is what says which
  // entity `brand` points at.
  const brandSource = useEntityLinkSource<ProductBrand, TContext>(brandLink, {
    descriptor: descriptors.find(entry => entry.name === 'brand')!,
    selectedId: form.values.brand === '' ? undefined : form.values.brand,
    selectedEntity: form.links['brand'] as ProductBrand | undefined,
  });
  const categorySource = useEntityLinkSource<ProductCategory, TContext>(
    categoryLink,
    {
      descriptor: descriptors.find(entry => entry.name === 'category')!,
      selectedId:
        form.values.category === '' ? undefined : form.values.category,
      selectedEntity: form.links['category'] as ProductCategory | undefined,
    },
  );

  // Emit the draft on every edit so the workspace host can autosave it.
  useEffect(() => {
    if (form.isDirty) onDraftChange?.(form.values);
  }, [form.values, form.isDirty, onDraftChange]);

  return (
    <EntityForm<Product>
      entityConstructor={Product}
      entity={entity}
      // The catalog form is edit-only; the read/edit toggle is for callers that
      // opt into it.
      mode="edit"
      values={form.values}
      onFieldChange={form.setField}
      linkSources={{ brand: brandSource, category: categorySource }}
      onLinkChange={form.setLink}
      errors={form.errors}
      onSubmit={form.submit}
      onDelete={onDelete}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      title={et(entity ? 'product.form.editTitle' : 'product.form.newTitle')}
    >
      <EntityField<Product> field="id" hidden />
    </EntityForm>
  );
}
