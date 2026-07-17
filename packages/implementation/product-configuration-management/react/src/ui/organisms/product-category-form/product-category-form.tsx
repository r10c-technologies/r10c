'use client';

import { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import { Button, Card, Stack, Text } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { fieldStyle, FormField } from '../../molecules/form-field';
import type { ProductCategoryFormProps } from './product-category-form.types';

/**
 * Create/update form for a {@link ProductCategory}.
 *
 * The organism owns only the field state; it never learns the transport. It
 * hands a fully-built entity to `onSave` and lets the page decide what running
 * the use-case means.
 *
 * Fields seed from `entity` once, at mount. The record loads asynchronously, so
 * the page keys this component by the record's identity — that remounts it when
 * the record arrives (or changes) and reseeds the fields, without an effect that
 * would clobber typing on every render.
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
  const [code, setCode] = useState(() => entity?.code ?? '');
  const [name, setName] = useState(() => entity?.name ?? '');
  const [description, setDescription] = useState(
    () => entity?.description ?? ''
  );

  const handleSubmit = () => {
    // Build a fresh instance rather than mutating the loaded one: `entity` is a
    // prop, and every persisted field is on this form, so nothing is lost.
    const target = new ProductCategory(code, name);
    target.id = entity?.id;
    target.description = description === '' ? undefined : description;
    onSave(target);
  };

  const busy = isSaving || isDeleting;

  return (
    <Card>
      <Stack gap="s">
        <Text as="h2">
          {entity ? 'Edit product category' : 'New product category'}
        </Text>

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
