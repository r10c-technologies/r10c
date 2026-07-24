'use client';

import { Product } from '@r10c/business-ts-product-configuration-management';
import { Button, Card, Stack, Text } from '@r10c/entifix-react-controls';
import { useState } from 'react';

import { fieldStyle, FormField } from '../../molecules/form-field';
import type {
  ProductFormDraft,
  ProductFormProps,
} from './product-form.types';

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
  initialDraft,
  onDraftChange,
}: ProductFormProps) {
  // One draft object rather than a field-per-`useState`, so the whole thing can
  // seed from a persisted draft and be emitted on every edit for autosave.
  const [fields, setFields] = useState<ProductFormDraft>(
    () =>
      initialDraft ?? {
        code: entity?.code ?? '',
        name: entity?.name ?? '',
        description: entity?.description ?? '',
        brandId: String(entity?.brand.id ?? ''),
        categoryId: String(entity?.category.id ?? ''),
      },
  );

  const update = (patch: Partial<ProductFormDraft>) => {
    setFields(previous => {
      const next = { ...previous, ...patch };
      onDraftChange?.(next);
      return next;
    });
  };

  const handleSubmit = () => {
    const target = new Product(fields.code, fields.name);
    target.id = entity?.id;
    target.description = fields.description === '' ? undefined : fields.description;

    // brand travels embedded, so hand the link the whole instance.
    const brand = brands.find(
      candidate => String(candidate.id) === fields.brandId,
    );
    target.brand.setValue(brand);

    // category travels as a foreign key, so hand the link only the id.
    target.category.setId(fields.categoryId === '' ? undefined : fields.categoryId);

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
            value={fields.code}
            onChange={event => update({ code: event.currentTarget.value })}
            style={fieldStyle}
          />
        </FormField>

        <FormField label="name" htmlFor="name">
          <input
            id="name"
            name="name"
            value={fields.name}
            onChange={event => update({ name: event.currentTarget.value })}
            style={fieldStyle}
          />
        </FormField>

        <FormField label="description" htmlFor="description">
          <input
            id="description"
            name="description"
            value={fields.description}
            onChange={event =>
              update({ description: event.currentTarget.value })
            }
            style={fieldStyle}
          />
        </FormField>

        <FormField label="brand (embedded)" htmlFor="brand">
          <select
            id="brand"
            name="brand"
            value={fields.brandId}
            onChange={event => update({ brandId: event.currentTarget.value })}
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
            value={fields.categoryId}
            onChange={event =>
              update({ categoryId: event.currentTarget.value })
            }
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
