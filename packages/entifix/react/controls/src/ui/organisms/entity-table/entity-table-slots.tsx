import type { Entity, MetaAccessorType } from '@r10c/entifix-ts-core';
import { Children, isValidElement, type ReactNode } from 'react';

import type { EntityTableColumn } from './entity-table.types';

/**
 * The declarative customization API. Slots are configuration expressed as JSX:
 * they never render themselves — `EntityTable` reads their props and decides
 * where the configuration applies. That keeps simple tables to a single
 * self-closing tag while complex ones stay declarative instead of drowning in
 * option objects.
 */

export interface EntityColumnProps<TEntity extends Entity = Entity> {
  /** Accessor name. Unknown names create an extra, entity-less column. */
  field: string;
  label?: string;
  header?: ReactNode;
  type?: MetaAccessorType;
  order?: number;
  sortable?: boolean;
  filterable?: boolean;
  render?: (item: TEntity) => ReactNode;
}

/** Overrides one metadata-derived column, or adds a computed one. */
export function EntityColumn<TEntity extends Entity = Entity>(
  _props: EntityColumnProps<TEntity>,
): ReactNode {
  return null;
}

export interface EntityTableHeaderProps<TEntity extends Entity = Entity> {
  /** Replaces the whole header row. Receives the resolved visible columns. */
  render: (columns: Array<EntityTableColumn<TEntity>>) => ReactNode;
}

export function EntityTableHeader<TEntity extends Entity = Entity>(
  _props: EntityTableHeaderProps<TEntity>,
): ReactNode {
  return null;
}

export interface EntityTableRowProps<TEntity extends Entity = Entity> {
  /** Replaces the whole body row for every item. */
  render: (
    item: TEntity,
    columns: Array<EntityTableColumn<TEntity>>,
  ) => ReactNode;
}

export function EntityTableRow<TEntity extends Entity = Entity>(
  _props: EntityTableRowProps<TEntity>,
): ReactNode {
  return null;
}

export interface EntityTableToolbarProps {
  children?: ReactNode;
}

/** Extra actions placed alongside the built-in toolbar controls. */
export function EntityTableToolbar(_props: EntityTableToolbarProps): ReactNode {
  return null;
}

export interface EntityTableSlots<TEntity extends Entity> {
  columns: Array<EntityColumnProps<TEntity>>;
  header?: EntityTableHeaderProps<TEntity>;
  row?: EntityTableRowProps<TEntity>;
  toolbar?: ReactNode;
  /** Children that matched no slot — rendered below the table untouched. */
  rest: ReactNode[];
}

/**
 * Sorts children into slots.
 *
 * Matching is by component identity rather than by `displayName`: identity
 * survives minification and cannot collide with an unrelated component that
 * happens to share a name.
 */
export function readEntityTableSlots<TEntity extends Entity>(
  children: ReactNode,
): EntityTableSlots<TEntity> {
  const slots: EntityTableSlots<TEntity> = { columns: [], rest: [] };

  Children.toArray(children).forEach(child => {
    if (!isValidElement(child)) {
      slots.rest.push(child);
      return;
    }

    switch (child.type) {
      case EntityColumn:
        slots.columns.push(child.props as EntityColumnProps<TEntity>);
        break;
      case EntityTableHeader:
        slots.header = child.props as EntityTableHeaderProps<TEntity>;
        break;
      case EntityTableRow:
        slots.row = child.props as EntityTableRowProps<TEntity>;
        break;
      case EntityTableToolbar:
        slots.toolbar = (child.props as EntityTableToolbarProps).children;
        break;
      default:
        slots.rest.push(child);
    }
  });

  return slots;
}
