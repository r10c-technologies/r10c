'use client';

import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import { reconstructEntity } from '@r10c/entifix-ts-core';

import type { ProductCategoryFormProps } from './product-category-form.types';

/**
 * Create/update form for a {@link ProductCategory}. Like {@link ProductBrandForm},
 * a thin wrapper over the agnostic {@link EntityForm}: every field, label and
 * validation rule comes from the entity's own accessor metadata, and
 * `reconstructEntity` derives the submit rebuild from that same metadata.
 *
 * It never learns the transport — it hands a fully-built entity to `onSave` and
 * lets the page decide what running the use-case means.
 */
export function ProductCategoryForm({
  entity,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  onSave,
  onDelete,
  backHref,
}: ProductCategoryFormProps) {
  const et = useT('entity');
  const form = useEntityForm<ProductCategory>({
    entityConstructor: ProductCategory,
    entity,
    // A fresh instance rather than the loaded one mutated: `entity` is a prop,
    // and every persisted field is on this form, so nothing is lost.
    onSubmit: values =>
      onSave(reconstructEntity(ProductCategory, values, { existing: entity })),
  });

  return (
    <EntityForm<ProductCategory>
      entityConstructor={ProductCategory}
      entity={entity}
      mode="edit"
      values={form.values}
      onFieldChange={form.setField}
      errors={form.errors}
      formError={form.formError}
      onSubmit={form.submit}
      onDelete={onDelete}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      // `entity` is undefined until the record lands, so testing it alone
      // titled a loading edit form "New" and then relabelled it (#139).
      title={et(
        entity || isLoading
          ? 'product-category.form.editTitle'
          : 'product-category.form.newTitle',
      )}
    >
      <EntityField<ProductCategory> field="id" hidden />
    </EntityForm>
  );
}
