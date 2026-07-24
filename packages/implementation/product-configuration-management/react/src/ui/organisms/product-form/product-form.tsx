'use client';

import { Product } from '@r10c/business-ts-product-configuration-management';
import { EntityField, EntityForm, Select } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import { useEffect } from 'react';

import type { ProductFormProps } from './product-form.types';

/**
 * Create/update form for a {@link Product}. It is now a thin wrapper over the
 * agnostic {@link EntityForm}: the generic form builds the scalar fields from
 * metadata, and this wrapper only supplies what is domain-specific — the two
 * relation pickers and the draft→`Product` reconstruction.
 *
 * The relations are written the way the catalog stores each: `brand` embedded
 * (`setValue`, so the whole instance serializes inline) and `category` as a
 * foreign key (`setId`, so only the scalar does). `useEntityForm` owns the
 * draft; the page keys this component by the record id so it reseeds on load.
 */
export function ProductForm({
  entity,
  brands,
  categories,
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
  const form = useEntityForm<Product>({
    entityConstructor: Product,
    entity,
    initialValues: initialDraft,
    onSubmit: values => {
      const product = new Product(values.code, values.name);
      product.id = entity?.id;
      product.description =
        values.description === '' ? undefined : values.description;

      // brand travels embedded, so hand the link the whole instance…
      const brand = brands.find(
        candidate => String(candidate.id) === values.brand,
      );
      product.brand.setValue(brand);
      // …category travels as a foreign key, so hand the link only the id.
      product.category.setId(values.category === '' ? undefined : values.category);

      onSave(product);
    },
  });

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
      errors={form.errors}
      onSubmit={form.submit}
      onDelete={onDelete}
      isLoading={isLoading}
      isSaving={isSaving}
      isDeleting={isDeleting}
      error={error}
      backHref={backHref}
      title={entity ? 'Edit product' : 'New product'}
    >
      <EntityField<Product> field="id" hidden />
      <EntityField<Product>
        field="brand"
        label="Brand (embedded)"
        render={({ value, setField, id }) => (
          <Select
            id={id}
            value={value}
            onChange={event => setField('brand', event.currentTarget.value)}
          >
            <option value="">— none —</option>
            {brands.map(brand => (
              <option key={String(brand.id)} value={String(brand.id)}>
                {brand.name}
              </option>
            ))}
          </Select>
        )}
      />
      <EntityField<Product>
        field="category"
        label="Category (foreign key)"
        render={({ value, setField, id }) => (
          <Select
            id={id}
            value={value}
            onChange={event => setField('category', event.currentTarget.value)}
          >
            <option value="">— none —</option>
            {categories.map(category => (
              <option key={String(category.id)} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </Select>
        )}
      />
    </EntityForm>
  );
}
