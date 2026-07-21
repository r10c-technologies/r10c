'use client';

import type {
  Entity,
  EntityFieldDescriptor,
  EntityFilter,
  FilterGroup,
  LogicOperator,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';
import { useCallback, useId, useState } from 'react';

import { Button } from '../../atoms/button';
import { Select, TextInput } from '../../atoms/field';
import { Text } from '../../atoms/text';
import {
  type EntityFilterOperator,
  OPERATOR_LABELS,
  operatorArity,
  operatorsForType,
} from './filter-operators';

/**
 * One in-progress filter row. Values are held as strings because that is what
 * the inputs produce; they are coerced to the member's type only when the row
 * is converted into an {@link EntityFilter}.
 */
interface FilterDraft {
  key: string;
  property: string;
  operator: EntityFilterOperator;
  value: string;
  end: string;
}

function coerce(raw: string, type: MetaAccessorType): unknown {
  if (raw === '') return undefined;
  switch (type) {
    case 'number':
      return Number(raw);
    case 'boolean':
      return raw === 'true';
    case 'date':
      return new Date(raw);
    default:
      return raw;
  }
}

/**
 * Converts a draft row into the wire filter, or `undefined` while the row is
 * still incomplete — a half-typed row must not reach the load request.
 */
function toFilter<TEntity extends Entity>(
  draft: FilterDraft,
  descriptor: EntityFieldDescriptor,
): EntityFilter<TEntity> | undefined {
  const property = descriptor.key as keyof TEntity;

  switch (operatorArity(draft.operator)) {
    case 'none':
      return { property, operator: draft.operator } as EntityFilter<TEntity>;
    case 'list': {
      const values = draft.value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '')
        .map(entry => coerce(entry, descriptor.type));
      return values.length === 0
        ? undefined
        : ({
            property,
            operator: draft.operator,
            values,
          } as EntityFilter<TEntity>);
    }
    case 'range': {
      const start = coerce(draft.value, descriptor.type);
      const end = coerce(draft.end, descriptor.type);
      return start === undefined || end === undefined
        ? undefined
        : ({
            property,
            operator: draft.operator,
            start,
            end,
          } as EntityFilter<TEntity>);
    }
    default: {
      const value = coerce(draft.value, descriptor.type);
      return value === undefined
        ? undefined
        : ({
            property,
            operator: draft.operator,
            value,
          } as EntityFilter<TEntity>);
    }
  }
}

/**
 * Rebuilds the editable rows from an already-applied filter, so reopening the
 * panel shows what is actually in effect rather than an empty form. Only the
 * flat rows this builder can express are restored — a group nested by some
 * other means is left to the caller to re-enter.
 */
function toDrafts<TEntity extends Entity>(
  filtering: FilterGroup<TEntity> | undefined,
  idPrefix: string,
): FilterDraft[] {
  if (!filtering) return [];

  return filtering.values.flatMap((node, index) => {
    if (!('property' in node)) return [];
    const filter = node as {
      property: unknown;
      operator: EntityFilterOperator;
      value?: unknown;
      values?: unknown[];
      start?: unknown;
      end?: unknown;
    };
    const text = (value: unknown) =>
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : value === undefined
          ? ''
          : String(value);

    return [
      {
        key: `${idPrefix}-applied-${index}`,
        property: String(filter.property),
        operator: filter.operator,
        value: filter.values
          ? filter.values.map(text).join(', ')
          : text(filter.start ?? filter.value),
        end: text(filter.end),
      },
    ];
  });
}

export interface FilterBuilderProps<TEntity extends Entity> {
  /** Filterable members, already resolved from the entity metadata. */
  descriptors: readonly EntityFieldDescriptor[];
  /** The filtering currently applied, used to seed the rows. */
  value?: FilterGroup<TEntity>;
  onChange: (filtering: FilterGroup<TEntity>) => void;
}

/**
 * Builds an `EntityFiltering` value from entity metadata: the member list, the
 * operators offered and the shape of the value control all come from each
 * member's descriptor, so no per-entity filter UI has to be written.
 *
 * Editing is a draft. `onChange` fires only on **Apply**, because the value
 * feeds a load request: emitting per keystroke would put one HTTP request on
 * the wire per character typed.
 */
export function FilterBuilder<TEntity extends Entity>({
  descriptors,
  value: applied,
  onChange,
}: FilterBuilderProps<TEntity>) {
  const idPrefix = useId();
  const [logic, setLogic] = useState<LogicOperator>(applied?.operator ?? 'and');
  const [drafts, setDrafts] = useState<FilterDraft[]>(() =>
    toDrafts(applied, idPrefix),
  );

  const descriptorFor = useCallback(
    (name: string) => descriptors.find(entry => entry.name === name),
    [descriptors],
  );

  const apply = useCallback(
    (nextDrafts: FilterDraft[], nextLogic: LogicOperator) => {
      const values = nextDrafts
        .map(draft => {
          const descriptor = descriptorFor(draft.property);
          return descriptor ? toFilter<TEntity>(draft, descriptor) : undefined;
        })
        .filter(
          (filter): filter is EntityFilter<TEntity> => filter !== undefined,
        );

      onChange({ operator: nextLogic, values });
    },
    [descriptorFor, onChange],
  );

  /** Edits the draft only — nothing reaches the caller until Apply. */
  const update = (nextDrafts: FilterDraft[]) => setDrafts(nextDrafts);

  const addRow = () => {
    const first = descriptors[0];
    // Defence in depth: the component returns early for an empty descriptor
    // list, so this button does not exist without a first member.
    /* v8 ignore next */
    if (!first) return;
    update([
      ...drafts,
      {
        key: `${idPrefix}-${drafts.length}-${Date.now()}`,
        property: first.name,
        operator: operatorsForType(first.type)[0],
        value: '',
        end: '',
      },
    ]);
  };

  const patch = (key: string, changes: Partial<FilterDraft>) =>
    update(
      drafts.map(draft =>
        draft.key === key ? { ...draft, ...changes } : draft,
      ),
    );

  if (descriptors.length === 0) {
    return (
      <Text step={-1} tone="muted">
        No filterable members on this entity.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2xs">
      <div className="flex items-center gap-2xs">
        <Text step={-2} tone="muted">
          Match
        </Text>
        <Select
          aria-label="Match all or any filter"
          value={logic}
          onChange={event => {
            setLogic(event.target.value as LogicOperator);
          }}
        >
          <option value="and">all</option>
          <option value="or">any</option>
        </Select>
      </div>

      {drafts.map(draft => {
        const descriptor = descriptorFor(draft.property);
        if (!descriptor) return null;
        const arity = operatorArity(draft.operator);

        return (
          <div key={draft.key} className="flex flex-wrap items-center gap-2xs">
            <Select
              aria-label="Filter member"
              value={draft.property}
              onChange={event => {
                const next = descriptorFor(event.target.value);
                // Defence in depth: the options are built from `descriptors`,
                // so a chosen value always resolves.
                /* v8 ignore next */
                if (!next) return;
                patch(draft.key, {
                  property: next.name,
                  // The previous operator may not exist for the new type.
                  operator: operatorsForType(next.type)[0],
                  value: '',
                  end: '',
                });
              }}
            >
              {descriptors.map(entry => (
                <option key={entry.name} value={entry.name}>
                  {entry.label}
                </option>
              ))}
            </Select>

            <Select
              aria-label="Filter operator"
              value={draft.operator}
              onChange={event =>
                patch(draft.key, {
                  operator: event.target.value as EntityFilterOperator,
                })
              }
            >
              {operatorsForType(descriptor.type).map(operator => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </Select>

            {arity !== 'none' && (
              <FilterValueInput
                descriptor={descriptor}
                arity={arity}
                value={draft.value}
                end={draft.end}
                onValueChange={value => patch(draft.key, { value })}
                onEndChange={end => patch(draft.key, { end })}
              />
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove filter"
              onClick={() =>
                update(drafts.filter(entry => entry.key !== draft.key))
              }
            >
              ✕
            </Button>
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2xs">
        <Button type="button" variant="secondary" size="sm" onClick={addRow}>
          Add filter
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          aria-label="Apply filters"
          onClick={() => apply(drafts, logic)}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Clear filters"
          onClick={() => {
            setDrafts([]);
            setLogic('and');
            // Applying the emptied form is what actually clears the listing;
            // dropping the rows alone would leave the old filter in effect.
            apply([], 'and');
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

interface FilterValueInputProps {
  descriptor: EntityFieldDescriptor;
  arity: ReturnType<typeof operatorArity>;
  value: string;
  end: string;
  onValueChange: (value: string) => void;
  onEndChange: (end: string) => void;
}

/** The value control the member's type calls for. */
function FilterValueInput({
  descriptor,
  arity,
  value,
  end,
  onValueChange,
  onEndChange,
}: FilterValueInputProps) {
  if (descriptor.type === 'boolean') {
    return (
      <Select
        aria-label="Filter value"
        value={value}
        onChange={event => onValueChange(event.target.value)}
      >
        <option value="">—</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    );
  }

  if (descriptor.type === 'enum' && descriptor.enumValues && arity !== 'list') {
    return (
      <Select
        aria-label="Filter value"
        value={value}
        onChange={event => onValueChange(event.target.value)}
      >
        <option value="">—</option>
        {descriptor.enumValues.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }

  const inputType =
    descriptor.type === 'number'
      ? 'number'
      : descriptor.type === 'date'
        ? 'date'
        : 'text';

  return (
    <>
      <TextInput
        aria-label="Filter value"
        type={arity === 'list' ? 'text' : inputType}
        placeholder={arity === 'list' ? 'comma, separated, values' : undefined}
        value={value}
        onChange={event => onValueChange(event.target.value)}
      />
      {arity === 'range' && (
        <TextInput
          aria-label="Filter range end"
          type={inputType}
          value={end}
          onChange={event => onEndChange(event.target.value)}
        />
      )}
    </>
  );
}
