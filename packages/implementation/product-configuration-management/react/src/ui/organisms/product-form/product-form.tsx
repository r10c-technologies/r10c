'use client';

import { Product } from '@r10c/business-ts-product-configuration-management';
import { Button, Card, Stack, Text } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { fieldStyle, FormField } from '../../molecules/form-field';
import type { ProductFormProps } from './product-form.types';

/**
 * Create/update form for a {@link Product}, including its two relations.
 *
 * The relations are written through the link API rather than a setter (link
 * accessors are getter-only by design), and each is written the way the catalog
 * stores it: `brand` embedded, `category` as a foreign key. Picking the matching
 * call is what keeps the stored shape stable across a round-trip — `setValue`
 * serializes the whole object inline, `setId` serializes a scalar.
 *
 * Fields seed at mount; the page keys this component by the record's identity so
 * it reseeds when the record arrives. See {@link ProductCategoryForm}.
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
}: ProductFormProps) {
  const [code, setCode] = useState(() => entity?.code ?? '');
  const [name, setName] = useState(() => entity?.name ?? '');
  const [description, setDescription] = useState(
    () => entity?.description ?? ''
  );
  const [brandId, setBrandId] = useState(() =>
    String(entity?.brand.id ?? '')
  );
  const [categoryId, setCategoryId] = useState(() =>
    String(entity?.category.id ?? '')
  );

  const handleSubmit = () => {
    const target = new Product(code, name);
    target.id = entity?.id;
    target.description = description === '' ? undefined : description;

    // brand travels embedded, so hand the link the whole instance.
    const brand = brands.find(candidate => String(candidate.id) === brandId);
    target.brand.setValue(brand);

    // category travels as a foreign key, so hand the link only the id.
    target.category.setId(categoryId === '' ? undefined : categoryId);

    onSave(target);
  };

  const busy = isSaving || isDeleting;

  return (
    <Card>
      <Stack gap="s">
        <Text as="h2">{entity ? 'Edit product' : 'New product'}</Text>

        {isLoading && <Text data-testid="form-loading">Loading…</Text>}
        {error && <Text data-testid="form-error">{error.message}</Text>}

        <FormField label="code" htmlFor="code">
          <input
            id="code"
            name="code"
            value={code}
            onChange={event => setCode(event.currentTarget.value)}
            style={fieldStyle}
          />
        </FormField>

        <FormField label="name" htmlFor="name">
          <input
            id="name"
            name="name"
            value={name}
            onChange={event => setName(event.currentTarget.value)}
            style={fieldStyle}
          />
        </FormField>

        <FormField label="description" htmlFor="description">
          <input
            id="description"
            name="description"
            value={description}
            onChange={event => setDescription(event.currentTarget.value)}
            style={fieldStyle}
          />
        </FormField>

        <FormField label="brand (embedded)" htmlFor="brand">
          <select
            id="brand"
            name="brand"
            value={brandId}
            onChange={event => setBrandId(event.currentTarget.value)}
            style={fieldStyle}
          >
            <option value="">— none —</option>
            {brands.map(brand => (
              <option key={String(brand.id)} value={String(brand.id)}>
                {brand.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="category (foreign key)" htmlFor="category">
          <select
            id="category"
            name="category"
            value={categoryId}
            onChange={event => setCategoryId(event.currentTarget.value)}
            style={fieldStyle}
          >
            <option value="">— none —</option>
            {categories.map(category => (
              <option key={String(category.id)} value={String(category.id)}>
                {category.name}
              </option>
            ))}
          </select>
        </FormField>

        <Stack direction="row" gap="xs">
          <Button type="button" onClick={handleSubmit} disabled={busy}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="secondary"
              onClick={onDelete}
              disabled={busy}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </Button>
          )}
          <a href={backHref}>
            <Button type="button" variant="ghost" disabled={busy}>
              Back
            </Button>
          </a>
        </Stack>
      </Stack>
    </Card>
  );
}
