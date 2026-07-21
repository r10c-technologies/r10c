import type {
  EntifixError,
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
  /**
   * The failure of the last load, if it failed.
   *
   * A listing that renders an empty table when the service is unreachable tells
   * the user their catalog is empty — the one thing they must not conclude. So
   * this is rendered as an alert, and it also changes the empty message.
   *
   * It arrives for free from `useDataLoading`, whose whole state is spread into
   * this component.
   */
  error?: EntifixError;
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

  /** The filtering currently applied, seeding the filter panel so it shows
   *  what is in effect rather than an empty form. */
  filtering?: FilterGroup<TEntity>;
  /** The sorting currently applied, seeding the sort panel. */
  sorting?: EntitySorting<TEntity>;

  /** Notified when the filter panel is **applied** — not while it is edited, so
   *  the value can feed a load request directly. */
  onFilteringChange?: (filtering: FilterGroup<TEntity>) => void;
  /** Notified when the sort panel is applied. */
  onSortingChange?: (sorting: EntitySorting<TEntity>) => void;

  /** Customization slots — see `entity-table-slots`. */
  children?: ReactNode;
}
