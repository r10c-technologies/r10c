'use client';

import {
  describeEntityColumns,
  type Entity,
  type EntityConstructor,
} from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import { useUiPreference } from '../../../preferences';
import type { ColumnPersonalization } from '../../molecules/column-settings';
import type { EntityTableColumn } from './entity-table.types';
import type { EntityColumnProps } from './entity-table-slots';

const EMPTY_PERSONALIZATION: ColumnPersonalization = {};

/**
 * Applies `<EntityColumn>` overrides on top of the metadata descriptors, and
 * appends a virtual column for any slot naming a member the entity does not
 * have (a computed column).
 */
function mergeSlots<TEntity extends Entity>(
  descriptors: Array<EntityTableColumn<TEntity>>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
): Array<EntityTableColumn<TEntity>> {
  const merged = descriptors.map(descriptor => {
    const slot = slotColumns.find(entry => entry.field === descriptor.name);
    if (!slot) return descriptor;
    const { field: _field, ...overrides } = slot;
    return {
      ...descriptor,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => value !== undefined),
      ),
    } as EntityTableColumn<TEntity>;
  });

  const virtual = slotColumns
    .filter(slot => !descriptors.some(entry => entry.name === slot.field))
    .map<EntityTableColumn<TEntity>>((slot, index) => ({
      name: slot.field,
      key: slot.field,
      label: slot.label ?? slot.field,
      type: slot.type ?? 'string',
      sortable: slot.sortable ?? false,
      filterable: slot.filterable ?? false,
      order: slot.order ?? descriptors.length + index,
      linkLabelProperty: 'name',
      header: slot.header,
      render: slot.render,
      virtual: true,
    }));

  return [...merged, ...virtual].sort(
    (left, right) => left.order - right.order,
  );
}

/**
 * Reorders columns per the stored personalization. Names the user never saw
 * (added to the entity after the layout was saved) keep their default position
 * at the end instead of vanishing, and stale names in the stored order are
 * dropped — so a saved layout degrades rather than breaks.
 */
function applyOrder<TEntity extends Entity>(
  columns: Array<EntityTableColumn<TEntity>>,
  order: string[] | undefined,
): Array<EntityTableColumn<TEntity>> {
  if (!order || order.length === 0) return columns;

  const ranked = order
    .map(name => columns.find(column => column.name === name))
    .filter((column): column is EntityTableColumn<TEntity> => !!column);
  const remaining = columns.filter(column => !order.includes(column.name));

  return [...ranked, ...remaining];
}

/**
 * The whole column pipeline as a pure function — metadata descriptors, then
 * slot overrides, then the user's stored layout. Kept separate from the hook so
 * the resolution rules can be reasoned about (and tested) without React.
 */
export function resolveEntityTableColumns<TEntity extends Entity>(
  described: Array<EntityTableColumn<TEntity>>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
  personalization: ColumnPersonalization,
): {
  columns: Array<EntityTableColumn<TEntity>>;
  visibleColumns: Array<EntityTableColumn<TEntity>>;
  hidden: string[];
} {
  const columns = applyOrder(
    mergeSlots(described, slotColumns),
    personalization.order,
  );
  const hidden = personalization.hidden ?? [];

  return {
    columns,
    visibleColumns: columns.filter(column => !hidden.includes(column.name)),
    hidden,
  };
}

export interface UseEntityTableColumnsResult<TEntity extends Entity> {
  /** Every column, in the user's order — what the settings popover lists. */
  columns: Array<EntityTableColumn<TEntity>>;
  /** The subset actually rendered. */
  visibleColumns: Array<EntityTableColumn<TEntity>>;
  hidden: string[];
  personalization: ColumnPersonalization;
  setPersonalization: (next: ColumnPersonalization) => void;
}

/**
 * Resolves the columns a table renders: entity metadata, then slot overrides,
 * then the user's persisted layout.
 */
export function useEntityTableColumns<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  slotColumns: Array<EntityColumnProps<TEntity>>,
  sample: TEntity | undefined,
  preferenceKey: string,
): UseEntityTableColumnsResult<TEntity> {
  const { value: personalization, setValue: setPersonalization } =
    useUiPreference<ColumnPersonalization>(
      preferenceKey,
      EMPTY_PERSONALIZATION,
    );

  const described = useMemo(
    () =>
      describeEntityColumns(entityConstructor, sample) as Array<
        EntityTableColumn<TEntity>
      >,
    [entityConstructor, sample],
  );

  // Not memoized: `slotColumns` is rebuilt from `children` on every render, so
  // any dependency list would miss every time. The work is a few array passes
  // over a handful of columns — cheaper than the comparison would be.
  const { columns, visibleColumns, hidden } = resolveEntityTableColumns(
    described,
    slotColumns,
    personalization,
  );

  return {
    columns,
    visibleColumns,
    hidden,
    personalization,
    setPersonalization,
  };
}
