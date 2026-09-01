'use client';

import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import { reconstructEntity } from '@r10c/entifix-ts-core';

import type { ProductBrandFormProps } from './product-brand-form.types';

/**
 * Create/update form for a {@link ProductBrand}. A thin wrapper over the
 * agnostic {@link EntityForm}: the generic form builds every field from the
 * entity's metadata — labels included, through each accessor's `labelKey` — and
 * `reconstructEntity` derives the submit reconstruction from the same metadata,
 * so nothing here is per-entity but the constructor and the titles.
 *
 * That is what carries `code` back. It is assigned by the create transaction and
 * the form hides it, but it is a plain writable member, so the rebuild picks it
 * out of the seeded draft rather than relying on anyone remembering to.
 *
 * `useEntityForm` owns the draft and seeds it once, so the page keys this
 * component by the record id to reseed when the record arrives.
 */
export function ProductBrandForm({
  entity,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  onSave,
  onDelete,
  backHref,
}: ProductBrandFormProps) {
  const et = useT('entity');
  const form = useEntityForm<ProductBrand>({
    entityConstructor: ProductBrand,
    entity,
    onSubmit: values =>
      onSave(reconstructEntity(ProductBrand, values, { existing: entity })),
  });

  return (
    <EntityForm<ProductBrand>
      entityConstructor={ProductBrand}
      entity={entity}
      // The catalog forms are edit-only; the read/edit toggle is for callers
      // that opt into it.
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
          ? 'product-brand.form.editTitle'
          : 'product-brand.form.newTitle',
      )}
    >
      <EntityField<ProductBrand> field="id" hidden />
      <EntityField<ProductBrand> field="code" hidden />
    </EntityForm>
  );
}
