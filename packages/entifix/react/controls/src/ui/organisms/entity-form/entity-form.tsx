'use client';

import {
  describeEntityColumns,
  EntifixLogicError,
  type Entity,
  type EntityAction,
  type EntityLinkSource,
  type MetaAccessorType,
  type UseCaseDescriptor,
} from '@r10c/entifix-ts-core';
import { type ReactNode, useId, useState } from 'react';

import {
  useErrorMessage,
  useLocalizedDescriptors,
  useT,
  useTranslateKey,
} from '../../../i18n';
import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
import { FieldControl } from '../../atoms/field-control';
import { Text } from '../../atoms/text';
import { Card } from '../../molecules/card';
import { ConfirmDialog } from '../../molecules/confirm-dialog';
import { EntityLinkInput } from '../../molecules/entity-link-input';
import { LoadingBoundary } from '../../molecules/loading-boundary';
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
 * The member types a `linkSources` entry can actually produce an editor for.
 *
 * `link` is the obvious one. `string` is here because a foreign key does not
 * have to be a typed relation: when the target lives in **another slice's
 * store**, an `EntityLink` would be an illegal edge and a storage-layer join
 * across a store boundary, so the member is a plain id and the relation exists
 * only in the operator's head (ADR 0022, and `ProductSpecification.brandId` is
 * the live case). Nothing about the editor cares which of the two it is —
 * `EntityLinkInput` writes `String(target.id)` into the draft either way, and
 * the *only* place `link`-ness still matters is `applyEntityLinks` at submit,
 * which skips a non-`link` descriptor and so leaves the id as the truth.
 *
 * Everything else is excluded on purpose rather than by omission: a `boolean`,
 * `enum`, `number` or `date` member cannot name another record, so a source
 * pointed at one is a wiring mistake — see {@link assertLinkSourcesAreEditable}.
 */
const PICKABLE_TYPES: ReadonlySet<MetaAccessorType> = new Set<MetaAccessorType>(
  ['link', 'string'],
);

/**
 * A form that builds itself from an entity's metadata: fields, labels and value
 * formatting all come from `@accessor()` declarations, so editing a new entity
 * needs no bespoke form. The read/edit toggle is the whole point — the same
 * component shows a record as text or as inputs.
 *
 * Two things layer on top of that default:
 * - **modes** — `read` renders each member through `CellValue`; `edit` renders
 *   the matching `FieldControl`. A member in {@link PICKABLE_TYPES} with an
 *   entry in `linkSources` gets the full picker instead — a to-one `link`, or a
 *   `string` holding a foreign key into another slice's store. Without a source,
 *   a relation stays read-only, and a `linkCollection` always does, the to-many
 *   editor being a follow-up. A source aimed at a member that can render no
 *   picker is a wiring mistake rather than a no-op, and throws.
 * - **slots** — `<EntityField>` children override one field's label, control or
 *   read display, or add a computed field.
 *
 * It is presentational: the draft, its errors and the save/delete actions are
 * all props, so the same form hosts on a plain route and inside a workspace tab.
 */
/** A verb waiting on its confirmation — narrowed so `confirm` is not optional. */
interface PendingConfirmation {
  key: string;
  labelKey: string;
  confirm: NonNullable<UseCaseDescriptor['confirm']>;
}

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
  metadata,
  isMetadataLoading = false,
  onUseCase,
  children,
}: EntityFormProps<TEntity>) {
  const formId = useId();
  const slots = readEntityFormFields<TEntity>(children);
  // The *field* descriptors, which stay local and synchronous — a column is a
  // property of the class every caller holds. Only an action's availability is
  // a property of the caller, which is why that half arrives as `metadata`.
  const columnDescriptors = describeEntityColumns(
    entityConstructor,
    entity,
  ) as Array<EntityFormField<TEntity>>;
  // Before slots resolve, so an `<EntityField label>` override still wins.
  const described = useLocalizedDescriptors(columnDescriptors);
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
  const translateKey = useTranslateKey();
  const errorMessage = useErrorMessage();
  const busy = isSaving || isDeleting;

  // Absent metadata keeps the pre-ADR-0026 behaviour, so an un-migrated call
  // site renders exactly as before. Present metadata is authoritative: it is
  // what the service already decided this caller may do.
  const may = (action: EntityAction) =>
    metadata === undefined || metadata.actions.includes(action);

  // A single-record form shows the verbs that act on *this* record. A
  // `context-dependent` one needs a selection to act on, which only a list has —
  // that is the bulk bar, not this. `collection`-bound verbs are not this
  // form's either.
  const useCases = (metadata?.useCases ?? []).filter(
    descriptor =>
      descriptor.binding === 'entity' &&
      descriptor.placement !== 'context-dependent',
  );
  const headerUseCases = useCases.filter(
    descriptor => descriptor.placement === 'context-independent',
  );
  const footerUseCases = useCases.filter(
    descriptor => descriptor.placement === 'determining',
  );

  // A descriptor carrying `confirm` must be asked about before it fires;
  // `revoke-sessions` ends every session a user holds. The state holds the
  // confirmation itself rather than the descriptor, so the dialog cannot be
  // opened for a verb that never asked for one.
  const [pending, setPending] = useState<PendingConfirmation | undefined>(
    undefined,
  );
  const invoke = (descriptor: UseCaseDescriptor) => {
    const confirm = descriptor.confirm;
    if (confirm) {
      setPending({
        key: descriptor.key,
        labelKey: descriptor.labelKey,
        confirm,
      });
      return;
    }
    onUseCase?.(descriptor.key);
  };

  const useCaseButton = (descriptor: UseCaseDescriptor) => (
    <Button
      key={descriptor.key}
      type="button"
      variant={
        descriptor.confirm?.tone === 'destructive' ? 'destructive' : 'secondary'
      }
      size={descriptor.placement === 'context-independent' ? 'sm' : 'md'}
      disabled={busy}
      onClick={() => invoke(descriptor)}
    >
      {/* A descriptor's labels are *runtime* catalog keys — they never resolve
          at compile time, which is why `@r10c/i18n-check` is what catches a
          typo here rather than the type system. */}
      {translateKey(descriptor.labelKey)}
    </Button>
  );

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
          <LoadingBoundary isLoading={isMetadataLoading} lines={0}>
            <>{headerUseCases.map(useCaseButton)}</>
          </LoadingBoundary>
        </Stack>

        {isLoading && (
          <LoadingBoundary
            isLoading
            lines={3}
            label={t('form.loading')}
            className="w-full"
          >
            {null}
          </LoadingBoundary>
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
            {may('write') && (
              <Button
                type="button"
                onClick={() => onSubmit?.(draft)}
                disabled={busy}
              >
                {isSaving ? t('form.saving') : t('form.save')}
              </Button>
            )}
            {onDelete && may('delete') && (
              <Button
                type="button"
                variant="secondary"
                onClick={onDelete}
                disabled={busy}
              >
                {isDeleting ? t('form.deleting') : t('form.delete')}
              </Button>
            )}
            {footerUseCases.map(useCaseButton)}
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

      {pending && (
        <ConfirmDialog
          open
          tone={pending.confirm.tone}
          title={translateKey(pending.labelKey)}
          message={translateKey(pending.confirm.messageKey)}
          busy={busy}
          onCancel={() => setPending(undefined)}
          onConfirm={() => {
            const key = pending.key;
            setPending(undefined);
            onUseCase?.(key);
          }}
        />
      )}
    </Card>
  );
}

/**
 * Refuse a `linkSources` entry that names a member no picker can be built for.
 *
 * `FieldRow` asks for {@link PICKABLE_TYPES} before it builds an editor, so a
 * source handed to anything else used to fall through to the read-only display
 * or a plain `FieldControl` with nothing said: the caller wired a picker, no
 * picker appeared, and the field was indistinguishable from one the entity had
 * declared read-only. That is a wiring mistake rather than a state — the entry
 * is dead in *every* shape such a field can render, since an
 * `<EntityField render>` slot is handed the draft and never the source — so it
 * costs the render instead of a warning nobody reads. `useEntityLinkSource`
 * already throws `EntifixLogicError` at render for the sibling mistake (a search
 * property the target does not declare `filterable`); this is the same fault
 * caught one level up.
 *
 * Two messages, because the two faults are not the same thing. A
 * `linkCollection` is a member the editor has simply not been built for yet
 * (#26), so the fix is to wait or to point at the to-one you meant. Any other
 * type is a member that can never name another record at all, so the fix is to
 * remove the entry.
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

  const sourced = fields.filter(
    field =>
      linkSources[field.name] !== undefined && !PICKABLE_TYPES.has(field.type),
  );
  if (sourced.length === 0) return;

  const toMany = sourced
    .filter(field => field.type === 'linkCollection')
    .map(field => field.name);
  if (toMany.length > 0) {
    throw new EntifixLogicError(
      `EntityForm was given a link source for a to-many member: ${toMany.join(', ')}. ` +
        'A `linkCollection` has no editor yet, so the source can only be dropped ' +
        'and the field would render read-only with no sign anything was wired. ' +
        'Remove the entry, or point it at the to-one `link` you meant.',
      undefined,
      { fields: toMany },
    );
  }

  const unpickable = sourced.map(field => `${field.name} (${field.type})`);
  throw new EntifixLogicError(
    `EntityForm was given a link source for a member that cannot hold one: ${unpickable.join(', ')}. ` +
      'A picker writes the target’s id into the draft, so the member has to be a ' +
      '`link` or the `string` that carries a foreign key. Remove the entry, or ' +
      'point it at the member that actually holds the reference.',
    undefined,
    { fields: sourced.map(field => field.name) },
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
 * else edits through `FieldControl` — or, when a source was supplied for a
 * member in {@link PICKABLE_TYPES}, through `EntityLinkInput`. A boolean edited
 * inline carries its own label, so the row does not add a second one.
 *
 * The source branch sits above the `virtual || isRelation` fallback and below
 * `field.render`, which is what lets a slot still override a picked field.
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
  } else if (linkSource && PICKABLE_TYPES.has(field.type)) {
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
