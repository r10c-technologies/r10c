'use client';

import {
  describeEntityColumns,
  EntifixLogicError,
  type Entity,
  type EntityLinkSource,
} from '@r10c/entifix-ts-core';
import { type ReactNode, useId, useState } from 'react';

import { useErrorMessage, useLocalizedDescriptors, useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
import { FieldControl } from '../../atoms/field-control';
import { Text } from '../../atoms/text';
import { Card } from '../../molecules/card';
import { EntityLinkInput } from '../../molecules/entity-link-input';
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
 *   the matching `FieldControl`. A to-one `link` with an entry in `linkSources`
 *   gets the full editor instead; without one — and for `linkCollection`
 *   always, the to-many editor being a follow-up — it stays read-only. A source
 *   *aimed at* a `linkCollection` is a wiring mistake rather than a no-op, and
 *   throws.
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
  linkSources,
  onLinkChange,
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
  assertLinkSourcesAreEditable(fields, linkSources);

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
            linkSource={linkSources?.[field.name]}
            onLinkChange={onLinkChange}
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

/**
 * Refuse a `linkSources` entry that names a to-many member.
 *
 * `FieldRow` asks for `field.type === 'link'` before it builds an editor, so a
 * source handed to a `linkCollection` used to fall through to the read-only
 * display with nothing said: the caller wired a picker, no picker appeared, and
 * the field was indistinguishable from one the entity had declared read-only.
 * That is a wiring mistake rather than a state — the entry is dead in *every*
 * shape a collection can render, since an `<EntityField render>` slot is handed
 * the draft and never the source — so it costs the render instead of a warning
 * nobody reads. `useEntityLinkSource` already throws `EntifixLogicError` at
 * render for the sibling mistake (a search property the target does not declare
 * `filterable`); this is the same fault caught one level up.
 *
 * Here rather than inside `FieldRow`, and that is the whole reason it is a
 * separate pass: a row only reaches its editor branch in **edit** mode, so a
 * per-row check would stay silent on a form that opens in `read` — the default
 * whenever there is a record — and then throw on a click, minutes later. One
 * pass over the registry fires on the first render either way.
 *
 * Against the resolved fields rather than the raw metadata: a slot may drop a
 * member, and a source left behind for a field that no longer renders is not
 * worth a page.
 */
function assertLinkSourcesAreEditable<TEntity extends Entity>(
  fields: Array<EntityFormField<TEntity>>,
  // Same reason as the prop's own declaration: a source's target is another
  // entity entirely and cannot be expressed in terms of `TEntity`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSources: Record<string, EntityLinkSource<any>> | undefined,
): void {
  if (linkSources === undefined) return;

  const toMany = fields
    .filter(
      field =>
        field.type === 'linkCollection' &&
        linkSources[field.name] !== undefined,
    )
    .map(field => field.name);
  if (toMany.length === 0) return;

  throw new EntifixLogicError(
    `EntityForm was given a link source for a to-many member: ${toMany.join(', ')}. ` +
      'A `linkCollection` has no editor yet, so the source can only be dropped ' +
      'and the field would render read-only with no sign anything was wired. ' +
      'Remove the entry, or point it at the to-one `link` you meant.',
    undefined,
    { fields: toMany },
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
  // The target of a relation is a different entity than the form's own.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSource: EntityLinkSource<any> | undefined;
  onLinkChange:
    ((name: string, entity: Entity | undefined) => void) | undefined;
  id: string;
}

/**
 * One label + control (or value) row. A `readonly` member renders its read
 * display even in edit mode, and so does a relation with no source; everything
 * else edits through `FieldControl` — or, for a relation that has a source,
 * through `EntityLinkInput`. A boolean edited inline carries its own label, so
 * the row does not add a second one.
 */
function FieldRow<TEntity extends Entity>({
  field,
  entity,
  draft,
  value,
  editing,
  error,
  setField,
  linkSource,
  onLinkChange,
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
  } else if (field.type === 'link' && linkSource) {
    control = (
      <EntityLinkInput
        descriptor={field}
        value={value}
        source={linkSource}
        id={id}
        disabled={field.readonly}
        onSelect={target => {
          setField(field.name, target.id == null ? '' : String(target.id));
          onLinkChange?.(field.name, target);
        }}
        onClear={() => {
          setField(field.name, '');
          onLinkChange?.(field.name, undefined);
        }}
      />
    );
  } else if (field.virtual || isRelation) {
    // A relation with no source has no input to offer, and a virtual field has
    // no member to edit unless a `render` was supplied — both fall back to the
    // read display.
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
