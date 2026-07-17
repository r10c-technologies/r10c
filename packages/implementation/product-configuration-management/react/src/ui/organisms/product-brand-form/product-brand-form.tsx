'use client';

import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import { Button, Card, Stack, Text } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { fieldStyle, FormField } from '../../molecules/form-field';
import type { ProductBrandFormProps } from './product-brand-form.types';

/**
 * Create/update form for a {@link ProductBrand}. Fields seed at mount; the page
 * keys this component by the record's identity so it reseeds when the record
 * arrives. See {@link ProductCategoryForm} for the reasoning.
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
  const [name, setName] = useState(() => entity?.name ?? '');
  const [description, setDescription] = useState(
    () => entity?.description ?? ''
  );
  const [website, setWebsite] = useState(() => entity?.website ?? '');

  const handleSubmit = () => {
    const target = new ProductBrand(name);
    target.id = entity?.id;
    target.description = description === '' ? undefined : description;
    target.website = website === '' ? undefined : website;
    onSave(target);
  };

  const busy = isSaving || isDeleting;

  return (
    <Card>
      <Stack gap="s">
        <Text as="h2">
          {entity ? 'Edit product brand' : 'New product brand'}
        </Text>

        {isLoading && <Text data-testid="form-loading">Loading…</Text>}
        {error && <Text data-testid="form-error">{error.message}</Text>}

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

        <FormField label="website" htmlFor="website">
          <input
            id="website"
            name="website"
            value={website}
            onChange={event => setWebsite(event.currentTarget.value)}
            style={fieldStyle}
          />
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
