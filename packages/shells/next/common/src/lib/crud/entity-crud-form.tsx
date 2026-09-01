'use client';

import { EntityField, EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityForm } from '@r10c/entifix-react-integration';
import {
  type EntifixError,
  type Entity,
  type EntityConstructor,
  reconstructEntity,
} from '@r10c/entifix-ts-core';
import { useEffect } from 'react';

import type {
  EntityCatalogKey,
  EntityCrudDraft,
  EntityCrudLinkSource,
} from './make-entity-crud.types';
import { useEntityLinkSources } from './use-entity-link-sources';

export interface EntityCrudFormProps<TEntity extends Entity> {
  readonly entityConstructor: EntityConstructor<TEntity>;
  readonly catalogKey: EntityCatalogKey;
  readonly hiddenFields: readonly string[];
  readonly links: readonly EntityCrudLinkSource[];
  /** The record being edited; `undefined` means this is a create. */
  readonly entity?: TEntity;
  readonly isLoading?: boolean;
  readonly isSaving?: boolean;
  readonly isDeleting?: boolean;
  readonly error?: EntifixError;
  readonly onSave: (entity: TEntity) => void;
  /** Omitted for a create — there is nothing to delete yet. */
  readonly onDelete?: () => void;
  readonly backHref: string;
  readonly initialDraft?: EntityCrudDraft;
  readonly onDraftChange?: (draft: EntityCrudDraft) => void;
}

/**
 * The generated create/update form. A thin wrapper over the agnostic
 * {@link EntityForm}: every field, label and validation rule comes from the
 * entity's own accessor metadata, and `reconstructEntity` derives the submit
 * rebuild from that same metadata — so nothing here is per-entity but the
 * constructor, the catalog key and the hidden-field list.
 *
 * A hidden member still round-trips. `code` is assigned by the create
 * transaction and never shown, but it is a plain writable member, so the rebuild
 * picks it out of the seeded draft; dropping it from the rendered fields is not
 * dropping it from the draft.
 *
 * `useEntityForm` owns the draft and seeds it once, so the page keys this
 * component by the record id to reseed when the record arrives.
 */
export function EntityCrudForm<TEntity extends Entity>({
  entityConstructor,
  catalogKey,
  hiddenFields,
  links,
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
}: EntityCrudFormProps<TEntity>) {
  const et = useT('entity');

  const form = useEntityForm<TEntity>({
    entityConstructor,
    entity,
    initialValues: initialDraft,
    onSubmit: values =>
      onSave(
        reconstructEntity(entityConstructor, values, { existing: entity }),
      ),
  });

  const linkSources = useEntityLinkSources(links, {
    values: form.values,
    selection: form.links,
  });

  // Emit the draft on every edit so a workspace host can autosave it.
  useEffect(() => {
    if (form.isDirty) onDraftChange?.(form.values);
  }, [form.values, form.isDirty, onDraftChange]);

  return (
    <EntityForm<TEntity>
      entityConstructor={entityConstructor}
      entity={entity}
      // Edit-only; the read/edit toggle is for callers that opt into it.
      mode="edit"
      values={form.values}
      onFieldChange={form.setField}
      linkSources={linkSources}
      onLinkChange={form.setLink}
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
          ? `${catalogKey}.form.editTitle`
          : `${catalogKey}.form.newTitle`,
      )}
    >
      {hiddenFields.map(field => (
        <EntityField<TEntity> key={field} field={field} hidden />
      ))}
    </EntityForm>
  );
}
