'use client';

import type {
  Entity,
  EntityFieldDescriptor,
  EntitySorting,
  EntitySortType,
} from '@r10c/entifix-ts-core';
import { useCallback, useState } from 'react';

import { Button } from '../../atoms/button';
import { Select } from '../../atoms/field';
import { Text } from '../../atoms/text';

interface SortDraft {
  property: string;
  type: EntitySortType;
}

/**
 * Rebuilds the rows from an already-applied sorting, so reopening the panel
 * shows what is actually in effect. The numeric keys are the precedence, so
 * they are walked in order.
 */
function toDrafts<TEntity extends Entity>(
  sorting: EntitySorting<TEntity> | undefined,
  descriptors: readonly EntityFieldDescriptor[],
): SortDraft[] {
  if (!sorting) return [];

  return Object.keys(sorting)
    .map(Number)
    .sort((left, right) => left - right)
    .flatMap(priority => {
      const entry = sorting[priority];
      if (!entry) return [];
      // Rows address members by accessor name; an applied value carries the
      // wire key, which is the same string unless the member declared an alias.
      const descriptor = descriptors.find(
        candidate =>
          candidate.key === String(entry.property) ||
          candidate.name === String(entry.property),
      );
      return descriptor
        ? [{ property: descriptor.name, type: entry.type }]
        : [];
    });
}

export interface SortBuilderProps<TEntity extends Entity> {
  /** Sortable members, already resolved from the entity metadata. */
  descriptors: readonly EntityFieldDescriptor[];
  /** The sorting currently applied, used to seed the rows. */
  value?: EntitySorting<TEntity>;
  onChange: (sorting: EntitySorting<TEntity>) => void;
}

/**
 * Builds an `EntitySorting` value — a precedence-ordered map, so the list order
 * here *is* the sort priority. Reordering uses explicit buttons for the same
 * reasons as the column settings.
 *
 * As in the filter builder, editing is a draft and `onChange` fires only on
 * **Apply**: each emission is a round trip to the server.
 */
export function SortBuilder<TEntity extends Entity>({
  descriptors,
  value: applied,
  onChange,
}: SortBuilderProps<TEntity>) {
  const [drafts, setDrafts] = useState<SortDraft[]>(() =>
    toDrafts(applied, descriptors),
  );

  const apply = useCallback(
    (next: SortDraft[]) => {
      const sorting = next.reduce<EntitySorting<TEntity>>(
        (accumulator, draft, index) => {
          const descriptor = descriptors.find(
            entry => entry.name === draft.property,
          );
          if (descriptor) {
            accumulator[index] = {
              property: descriptor.key as keyof TEntity,
              type: draft.type,
            };
          }
          return accumulator;
        },
        {} as EntitySorting<TEntity>,
      );
      onChange(sorting);
    },
    [descriptors, onChange],
  );

  /** Edits the draft only — nothing reaches the caller until Apply. */
  const update = (next: SortDraft[]) => setDrafts(next);

  const shift = (index: number, delta: number) => {
    const target = index + delta;
    // Defence in depth: the buttons are already disabled at both ends, so this
    // is unreachable through the UI — but an out-of-range splice would silently
    // corrupt the list rather than no-op.
    /* v8 ignore next */
    if (target < 0 || target >= drafts.length) return;
    const next = [...drafts];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    update(next);
  };

  if (descriptors.length === 0) {
    return (
      <Text step={-1} tone="muted">
        No sortable members on this entity.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2xs">
      {drafts.map((draft, index) => (
        <div
          key={`${draft.property}-${index}`}
          className="flex flex-wrap items-center gap-2xs"
        >
          <Text step={-2} tone="muted">
            {index === 0 ? 'Sort by' : 'then by'}
          </Text>
          <Select
            aria-label="Sort member"
            value={draft.property}
            onChange={event =>
              update(
                drafts.map((entry, position) =>
                  position === index
                    ? { ...entry, property: event.target.value }
                    : entry,
                ),
              )
            }
          >
            {descriptors.map(descriptor => (
              <option key={descriptor.name} value={descriptor.name}>
                {descriptor.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Sort direction"
            value={draft.type}
            onChange={event =>
              update(
                drafts.map((entry, position) =>
                  position === index
                    ? { ...entry, type: event.target.value as EntitySortType }
                    : entry,
                ),
              )
            }
          >
            <option value="asc">ascending</option>
            <option value="desc">descending</option>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Raise sort priority"
            disabled={index === 0}
            onClick={() => shift(index, -1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Lower sort priority"
            disabled={index === drafts.length - 1}
            onClick={() => shift(index, 1)}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Remove sort"
            onClick={() =>
              update(drafts.filter((_, position) => position !== index))
            }
          >
            ✕
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2xs">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            update([...drafts, { property: descriptors[0].name, type: 'asc' }])
          }
        >
          Add sort
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          aria-label="Apply sorting"
          onClick={() => apply(drafts)}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Clear sorting"
          onClick={() => {
            setDrafts([]);
            // Applying the emptied form is what restores the default order.
            apply([]);
          }}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
