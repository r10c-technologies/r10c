'use client';

import { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';

import type { ProductBrandFormProps } from './product-brand-form.types';

/**
 * Create/update form for a {@link ProductBrand}. A thin wrapper over the
 * agnostic {@link EntityForm}: the generic form builds every field from the
 * entity's metadata — labels included, through each accessor's `labelKey` — so
 * all that is left here is reconstructing the domain instance at submit.
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
    onSubmit: values => {
      const target = new ProductBrand(values.name);
      target.id = entity?.id;
      // `code` is assigned by the create transaction, so the form hides it but
      // still carries it back from the seeded draft — rebuilding without it
      // would blank the record's identifier on every update. It stays a plain
      // writable member on the entity: `readonly` would also drop it from
      // `serializeEntity`, so it would never reach the service at all.
      target.code = values.code === '' ? undefined : values.code;
      target.description =
        values.description === '' ? undefined : values.description;
      target.website = values.website === '' ? undefined : values.website;
      onSave(target);
    },
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
      title={et(
        entity ? 'product-brand.form.editTitle' : 'product-brand.form.newTitle',
      )}
    >
      <EntityField<ProductBrand> field="id" hidden />
      <EntityField<ProductBrand> field="code" hidden />
    </EntityForm>
  );
}
