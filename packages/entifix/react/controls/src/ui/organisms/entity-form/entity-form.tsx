'use client';

import { describeEntityColumns, type Entity } from '@r10c/entifix-ts-core';
import { type ReactNode, useId, useState } from 'react';

import { useErrorMessage, useLocalizedDescriptors, useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
import { FieldControl } from '../../atoms/field-control';
import { Text } from '../../atoms/text';
import { Card } from '../../molecules/card';
import { Stack } from '../../molecules/stack';
import type {
  EntityFormDraft,
  EntityFormField,
  EntityFormMode,
  EntityFormProps,
} from './entity-form.types';
import { readEntityFormFields } from './entity-form-slots';
import { resolveEntityFormFields } from './use-entity-form-fields';

/**
 * A form that builds itself from an entity's metadata: fields, labels and value
 * formatting all come from `@accessor()` declarations, so editing a new entity
 * needs no bespoke form. The read/edit toggle is the whole point — the same
 * component shows a record as text or as inputs.
 *
 * Two things layer on top of that default:
 * - **modes** — `read` renders each member through `CellValue`; `edit` renders
 *   the matching `FieldControl`. A relation stays read-only in both (its editor
 *   is a separate control) unless a slot supplies one.
 * - **slots** — `<EntityField>` children override one field's label, control or
 *   read display, or add a computed field.
 *
 * It is presentational: the draft, its errors and the save/delete actions are
 * all props, so the same form hosts on a plain route and inside a workspace tab.
 */
export function EntityForm<TEntity extends Entity>({
  entityConstructor,
  entity,
  values,
  onFieldChange,
  mode: modeProp,
  defaultMode,
  onModeChange,
  errors,
  formError,
  onSubmit,
  onDelete,
  isLoading = false,
  isSaving = false,
  isDeleting = false,
  error,
  backHref,
  title,
  children,
}: EntityFormProps<TEntity>) {
  const formId = useId();
  const slots = readEntityFormFields<TEntity>(children);
  const metadata = describeEntityColumns(entityConstructor, entity) as Array<
    EntityFormField<TEntity>
  >;
  // Before slots resolve, so an `<EntityField label>` override still wins.
  const described = useLocalizedDescriptors(metadata);
  const fields = resolveEntityFormFields(described, slots.fields);

  const [internalMode, setInternalMode] = useState<EntityFormMode>(
    defaultMode ?? (entity ? 'read' : 'edit'),
  );
  const mode = modeProp ?? internalMode;
  const editing = mode === 'edit';

  const draft: EntityFormDraft = values ?? {};
  const setField = (name: string, value: string) =>
    onFieldChange?.(name, value);

  const toggleMode = () => {
    const next: EntityFormMode = editing ? 'read' : 'edit';
    setInternalMode(next);
    onModeChange?.(next);
  };

  const t = useT();
  const errorMessage = useErrorMessage();
  const busy = isSaving || isDeleting;

  return (
    <Card>
      <Stack gap="s">
        <Stack direction="row" gap="xs" align="center">
          <Text as="h2" step={1} weight="semibold">
            {title ?? (entity ? t('form.details') : t('form.new'))}
          </Text>
          {/* The built-in toggle only appears when the form owns its mode and
              there is a record to view — a create form has nothing to read. */}
          {modeProp === undefined && entity && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={toggleMode}
            >
              {editing ? t('form.view') : t('form.edit')}
            </Button>
          )}
        </Stack>

        {isLoading && (
          <Text data-testid="entity-form-loading">{t('form.loading')}</Text>
        )}

        {error && (
          <p
            role="alert"
            data-testid="entity-form-error"
            className="rounded-sm border border-danger bg-danger-subtle px-s py-2xs text-step-sm text-danger"
          >
            {errorMessage(error)}
          </p>
        )}

        {fields.map(field => (
          <FieldRow
            key={field.name}
            field={field}
            entity={entity}
            draft={draft}
            value={draft[field.name] ?? ''}
            editing={editing}
            error={editing ? errors?.[field.name] : undefined}
            setField={setField}
            id={`${formId}-${field.name}`}
          />
        ))}

        {/* A cross-field rule has no row to sit under, so it sits with the
            actions it blocks. */}
        {editing && formError && (
          <span role="alert" className="text-step-sm text-danger">
            {formError}
          </span>
        )}

        {editing && (
          <Stack direction="row" gap="xs">
            <Button
              type="button"
              onClick={() => onSubmit?.(draft)}
              disabled={busy}
            >
              {isSaving ? t('form.saving') : t('form.save')}
            </Button>
            {onDelete && (
              <Button
                type="button"
                variant="secondary"
                onClick={onDelete}
                disabled={busy}
              >
                {isDeleting ? t('form.deleting') : t('form.delete')}
              </Button>
            )}
            {backHref && (
              <a href={backHref}>
                <Button type="button" variant="ghost" disabled={busy}>
                  {t('form.back')}
                </Button>
              </a>
            )}
          </Stack>
        )}

        {slots.rest}
      </Stack>
    </Card>
  );
}

interface FieldRowProps<TEntity extends Entity> {
  field: EntityFormField<TEntity>;
  entity: TEntity | undefined;
  draft: EntityFormDraft;
  value: string;
  editing: boolean;
  error: string | undefined;
  setField: (name: string, value: string) => void;
  id: string;
}

/**
 * One label + control (or value) row. A relation and a `readonly` member render
 * their read display even in edit mode; everything else edits through
 * `FieldControl`. A boolean edited inline carries its own label, so the row does
 * not add a second one.
 */
function FieldRow<TEntity extends Entity>({
  field,
  entity,
  draft,
  value,
  editing,
  error,
  setField,
  id,
}: FieldRowProps<TEntity>) {
  const readNode: ReactNode = field.readRender ? (
    field.readRender(entity)
  ) : (
    <CellValue
      value={
        entity ? (entity as Record<string, unknown>)[field.name] : undefined
      }
      descriptor={field}
    />
  );

  const isRelation = field.type === 'link' || field.type === 'linkCollection';

  let control: ReactNode;
  if (!editing) {
    control = readNode;
  } else if (field.render) {
    control = field.render({ draft, value, setField, id });
  } else if (field.virtual || isRelation) {
    // A relation has no default input, and a virtual field has no member to
    // edit unless a `render` was supplied — both fall back to the read display.
    control = readNode;
  } else {
    control = (
      <FieldControl
        descriptor={field}
        value={value}
        onChange={next => setField(field.name, next)}
        id={id}
      />
    );
  }

  const ownsLabel =
    editing && field.type === 'boolean' && !field.render && !field.virtual;

  return (
    <Stack gap="3xs">
      {!ownsLabel && (
        <label htmlFor={id} className="text-step-sm text-content-muted">
          {field.label}
        </label>
      )}
      {control}
      {error && (
        <span role="alert" className="text-step-sm text-danger">
          {error}
        </span>
      )}
    </Stack>
  );
}
