'use client';

import type {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import {
  useEntityForm,
  useEntityLinkSource,
} from '@r10c/entifix-react-integration';
import {
  describeEntityColumns,
  type EntityFieldDescriptor,
} from '@r10c/entifix-ts-core';
import { useEffect, useMemo } from 'react';

import type { ProductFormProps } from './product-form.types';

/**
 * The label and search member on the two targets.
 *
 * A descriptor's `linkLabelProperty`/`linkSearchProperty` normally come from the
 * owning `@accessor()`, which for a real `link` knows its target. `brandId` is a
 * plain `string` and cannot: `ProductSpecification` may not import
 * `catalog-reference` — that is the whole point of ADR 0022 — so the entity has
 * no vocabulary for "the target's name". `describeEntityColumns` happens to
 * default both to `'name'`, which is correct for `ProductBrand` and
 * `ProductCategory` alike, but relying on that would make the picker depend on a
 * default nothing states. So it is stated here, where the target type is already
 * named on the `useEntityLinkSource` call beside it.
 */
const TARGET_NAME_PROPERTY = 'name';

function pointAtTarget(
  descriptor: EntityFieldDescriptor,
): EntityFieldDescriptor {
  return {
    ...descriptor,
    linkLabelProperty: TARGET_NAME_PROPERTY,
    linkSearchProperty: TARGET_NAME_PROPERTY,
  };
}

/**
 * Create/update form for a {@link ProductSpecification}. A thin wrapper over
 * the agnostic {@link EntityForm}: the generic form builds every field from
 * metadata — classifications included, now that it can be handed a picker source
 * for a scalar id — and this wrapper only supplies the two sources and the
 * draft→`ProductSpecification` reconstruction.
 *
 * **The pickers edit plain ids, and that is the interesting part.** `brandId`
 * and `categoryId` are `string` members, not `link`s, because their targets live
 * in `catalog-reference` — a platform-plane store owned by another slice — and a
 * typed relation across that boundary is neither a legal import nor a join we
 * would want ([ADR 0022](../../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 * `EntityForm` writes the picked target's id straight into the draft, and
 * `applyEntityLinks` deliberately skips a non-`link` descriptor, so `onSubmit`
 * below keeps reading the draft strings and the id stays the truth.
 *
 * `form.setLink` still carries the picked instance in the selection sidecar. It
 * is not needed to *write* the relation — the id already went into the draft —
 * but it saves the round trip that would otherwise resolve the name a user just
 * chose from a list.
 *
 * One `useEntityLinkSource` call per classification, because React's hook count
 * has to stay fixed and the agnostic controls package may not reach the
 * integration layer to make the call itself.
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
    () => describeEntityColumns(ProductSpecification, entity),
    [entity],
  );

  const form = useEntityForm<ProductSpecification>({
    entityConstructor: ProductSpecification,
    entity,
    initialValues: initialDraft,
    onSubmit: values => {
      const product = new ProductSpecification(values.code, values.name);
      product.id = entity?.id;
      product.description =
        values.description === '' ? undefined : values.description;
      // Absent, not `''`. Nothing enforces this reference across the store
      // boundary, so an empty string would be a dangling id rather than "unset".
      product.brandId = values.brandId === '' ? undefined : values.brandId;
      product.categoryId =
        values.categoryId === '' ? undefined : values.categoryId;

      onSave(product);
    },
  });

  // The selection sidecar is keyed by field name and holds bare `Entity`, so the
  // target type is restated here — a scalar id member cannot carry it.
  const brandSource = useEntityLinkSource<ProductBrand, TContext>(brandLink, {
    descriptor: pointAtTarget(
      descriptors.find(entry => entry.name === 'brandId')!,
    ),
    selectedId: form.values.brandId === '' ? undefined : form.values.brandId,
    selectedEntity: form.links['brandId'] as ProductBrand | undefined,
  });
  const categorySource = useEntityLinkSource<ProductCategory, TContext>(
    categoryLink,
    {
      descriptor: pointAtTarget(
        descriptors.find(entry => entry.name === 'categoryId')!,
      ),
      selectedId:
        form.values.categoryId === '' ? undefined : form.values.categoryId,
      selectedEntity: form.links['categoryId'] as ProductCategory | undefined,
    },
  );

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
      linkSources={{ brandId: brandSource, categoryId: categorySource }}
      onLinkChange={form.setLink}
      errors={form.errors}
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
          ? 'product-specification.form.editTitle'
          : 'product-specification.form.newTitle',
      )}
    >
      <EntityField<ProductSpecification> field="id" hidden />
    </EntityForm>
  );
}
