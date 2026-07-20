import type {
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityId,
  EntitySorting,
  FilterGroup,
} from '@r10c/entifix-ts-core';
import type { ReactNode } from 'react';

/**
 * A column as the table finally renders it: the metadata descriptor plus the
 * per-column overrides a caller supplied through an `<EntityColumn>` slot.
 */
export interface EntityTableColumn<
  TEntity extends Entity,
> extends EntityFieldDescriptor {
  /** Replaces the default header text. */
  header?: ReactNode;
  /** Replaces the default `CellValue` rendering for this column. */
  render?: (item: TEntity) => ReactNode;
  /** True when the column has no backing entity member (slot-only column). */
  virtual?: boolean;
}

/** Breakpoint at and above which the table renders as a grid, not as cards. */
export type EntityTablePivotBreakpoint = 'sm' | 'md' | 'lg';

export interface EntityTableProps<TEntity extends Entity> {
  /** Metadata source. Columns, labels, types and the filter/sort controls all
   *  derive from this constructor's accessors. */
  entityConstructor: EntityConstructor<TEntity>;

  isLoading: boolean;
  items: Array<TEntity>;
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;

  /**
   * Builds the link to a row's record. Supplied as a function rather than the
   * table routing by itself: this package must not depend on a router, so the
   * caller (a shell page, which does know one) owns the URL shape.
   *
   * Omit it and the actions column is not rendered at all.
   */
  hrefFor?: (id: EntityId) => string;
  /** Link to the create form. Omit and no `New` action is rendered. */
  newHref?: string;

  /** Scope for persisted personalization. Defaults to the entity's key. */
  preferencesKey?: string;
  /** Hide the toolbar (columns, filters, sorting) — a bare listing. */
  showControls?: boolean;
  /** Viewport width at which rows stop pivoting into cards. Default `md`. */
  pivotBreakpoint?: EntityTablePivotBreakpoint;

  /** Notified as the filter panel is edited. Wiring the value into the load
   *  request is the caller's decision. */
  onFilteringChange?: (filtering: FilterGroup<TEntity>) => void;
  /** Notified as the sort panel is edited. */
  onSortingChange?: (sorting: EntitySorting<TEntity>) => void;

  /** Customization slots — see `entity-table-slots`. */
  children?: ReactNode;
}
