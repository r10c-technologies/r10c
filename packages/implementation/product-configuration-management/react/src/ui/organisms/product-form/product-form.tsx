'use client';

import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import { useEffect } from 'react';

import type { ProductFormProps } from './product-form.types';

/**
 * Create/update form for a {@link ProductSpecification}. A thin wrapper over
 * the agnostic {@link EntityForm}: the generic form builds every field from
 * metadata, and this wrapper only supplies the draft→`ProductSpecification`
 * reconstruction.
 *
 * **The brand and category pickers are gone**, and their absence is a real
 * regression worth naming. They were `EntityLinkPicker`s over `link` accessors;
 * those members are plain `brandId`/`categoryId` strings now, because their
 * targets moved to `catalog-reference` — a platform-plane store owned by another
 * slice — and a typed link across that boundary is not a legal edge
 * ([ADR 0022](../../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * Restoring a picker is legal and is follow-up work, not a dead end: the
 * `EntityLinkSource` port is framework-free and lives in core, so a source fed
 * by a marketplace-service adapter would satisfy it. What is missing is a picker
 * that writes a **scalar id** field rather than an `EntityLink` member. Until
 * then the ids are ordinary metadata-driven inputs.
 */
export function ProductForm({
  entity,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  onSave,
  onDelete,
  backHref,
  initialDraft,
  onDraftChange,
}: ProductFormProps) {
  const et = useT('entity');
  const form = useEntityForm<ProductSpecification>({
    entityConstructor: ProductSpecification,
    entity,
    initialValues: initialDraft,
    onSubmit: values => {
      const product = new ProductSpecification(values.code, values.name);
      product.id = entity?.id;
      product.description =
        values.description === '' ? undefined : values.description;
      product.brandId = values.brandId === '' ? undefined : values.brandId;
      product.categoryId =
        values.categoryId === '' ? undefined : values.categoryId;

      onSave(product);
    },
  });

  // Emit the draft on every edit so the workspace host can autosave it.
  useEffect(() => {
    if (form.isDirty) onDraftChange?.(form.values);
  }, [form.values, form.isDirty, onDraftChange]);

  return (
    <EntityForm<ProductSpecification>
      entityConstructor={ProductSpecification}
      entity={entity}
      // The catalog form is edit-only; the read/edit toggle is for callers that
      // opt into it.
      mode="edit"
      values={form.values}
      onFieldChange={form.setField}
      errors={form.errors}
      onSubmit={form.submit}
      onDelete={onDelete}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      title={et(
        entity
          ? 'product-specification.form.editTitle'
          : 'product-specification.form.newTitle',
      )}
    >
      <EntityField<ProductSpecification> field="id" hidden />
    </EntityForm>
  );
}
