'use client';

import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import type {
  Entity,
  EntityFieldDescriptor,
  EntityLinkSource,
} from '@r10c/entifix-ts-core';

import { useErrorMessage, useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { EntityLinkPicker } from '../entity-link-picker';
import { LoadingBoundary } from '../loading-boundary';

export interface EntityLinkInputProps<TTarget extends Entity> {
  /** The relation being edited. Its label names the controls. */
  descriptor: EntityFieldDescriptor;
  /** The held foreign key, as the draft carries it. `''` means unassigned. */
  value: string;
  source: EntityLinkSource<TTarget>;
  /** A target was chosen — in either mode. */
  onSelect: (entity: TTarget) => void;
  /** The relation was emptied. */
  onClear: () => void;
  /** The id the field's label points at. */
  id?: string;
  disabled?: boolean;
}

/** Chevron — the quick search. Inline so the package ships no icon dependency. */
function ChevronIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
      <path d="M5.5 7.5 10 12l4.5-4.5z" />
    </svg>
  );
}

/** Ellipsis — the browse dialog, the same affordance a desktop app uses. */
function EllipsisIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-4 fill-current">
      <circle cx="4" cy="10" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="16" cy="10" r="1.5" />
    </svg>
  );
}

/**
 * The editor for a to-one relation: what the value *is*, plus the two ways to
 * change it.
 *
 * - the chevron opens a type-ahead over the target entity — "I know roughly what
 *   it is called";
 * - the ellipsis opens the target's full table in a dialog — "I need to filter
 *   the catalog to find it".
 *
 * It is presentational. Every option, loading flag and error arrives through
 * {@link EntityLinkSource}, which the integration layer produces; this component
 * cannot fetch, and never decides how the relation is written back — it reports
 * the chosen instance and the form's reconstruction step applies the entity's own
 * `linkSerialization` policy.
 *
 * The displayed text is the target's label when one is known and the bare foreign
 * key when it is not, so a draft restored before its label resolves still shows
 * *something* true rather than an empty box.
 */
export function EntityLinkInput<TTarget extends Entity>({
  descriptor,
  value,
  source,
  onSelect,
  onClear,
  id,
  disabled = false,
}: EntityLinkInputProps<TTarget>) {
  const t = useT();
  const errorMessage = useErrorMessage();

  const assigned = value !== '';
  const label = source.selected.label ?? (assigned ? value : '');
  const display = source.selected.isLoading
    ? t('link.loading')
    : label === ''
      ? t('link.empty')
      : label;

  /**
   * Headless UI reports `null` when the search is abandoned (escape, blur). That
   * is not a request to empty the relation — clearing is the explicit action
   * beside the input — so it leaves the held value alone.
   */
  const handleSelect = (entity: TTarget | null) => {
    if (entity === null) return;
    onSelect(entity);
    source.quick.setTerm('');
  };

  return (
    <div className="flex flex-col gap-3xs">
      <div className="flex items-stretch gap-3xs">
        <div className="relative flex-1">
          <Combobox<TTarget | null>
            value={null}
            onChange={handleSelect}
            disabled={disabled}
            immediate
          >
            {/*
            The input edits the *search term*, never the value: the value is a
            foreign key, which is not something a user types. So it displays the
            resolved label while idle and the term while searching.
          */}
            <ComboboxInput
              id={id}
              aria-label={t('link.search', { field: descriptor.label })}
              placeholder={display}
              value={source.quick.term}
              disabled={disabled}
              onChange={event =>
                source.quick.setTerm(event.currentTarget.value)
              }
              className={[
                'w-full rounded-lg border border-border bg-surface-elevated px-2xs py-3xs',
                'text-step-sm text-content',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'disabled:cursor-not-allowed disabled:opacity-50',
              ].join(' ')}
            />
            <ComboboxButton
              aria-label={t('link.suggestAria', { field: descriptor.label })}
              className="absolute inset-y-0 right-0 flex items-center px-2xs text-content-muted"
            >
              <ChevronIcon />
            </ComboboxButton>
            <ComboboxOptions
              className={[
                'absolute z-50 mt-3xs max-h-64 w-full overflow-auto',
                'rounded-lg border border-border bg-surface-elevated p-3xs shadow-lg',
                'focus:outline-none',
              ].join(' ')}
            >
              {source.quick.isLoading && (
                <LoadingBoundary
                  isLoading
                  lines={2}
                  label={t('link.loading')}
                  className="px-2xs py-3xs"
                >
                  {null}
                </LoadingBoundary>
              )}
              {!source.quick.isLoading && source.quick.options.length === 0 && (
                <div className="px-2xs py-3xs text-step-sm text-content-muted">
                  {t('link.noResults')}
                </div>
              )}
              {source.quick.options.map(option => (
                <ComboboxOption
                  key={String(option.id)}
                  value={option}
                  className={[
                    'cursor-pointer rounded-md px-2xs py-3xs text-step-sm text-content',
                    'data-focus:bg-surface',
                  ].join(' ')}
                >
                  {source.labelOf(option)}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          aria-label={t('link.browseAria', { field: descriptor.label })}
          onClick={source.browse.open}
        >
          <EllipsisIcon />
        </Button>
        {/* Clearing is only offered when there is something to clear — and a
            required relation still offers it, because `required` is the form's
            rule to report, not the input's to enforce. */}
        {assigned && !disabled && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {t('link.clear', { field: descriptor.label })}
          </Button>
        )}
      </div>

      {/* The held value, always readable — the combobox input shows the term. */}
      <span
        data-testid={`entity-link-value-${descriptor.name}`}
        className="text-step-sm text-content"
      >
        {display}
      </span>

      {source.quick.error && (
        <span role="alert" className="text-step-sm text-danger">
          {errorMessage(source.quick.error)}
        </span>
      )}

      <EntityLinkPicker<TTarget>
        descriptor={descriptor}
        source={source}
        onSelect={entity => {
          onSelect(entity);
          source.browse.close();
        }}
      />
    </div>
  );
}
