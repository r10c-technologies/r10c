import type {
  BulkOutcome,
  EntifixError,
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityId,
  EntityMetadataDocument,
  EntitySelection,
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
   * What holds the table's shape during the first load.
   *
   * `true` (the default) renders the built-in placeholder, which is derived from
   * the table's own resolved geometry — one shimmer cell per visible column, so
   * the swap to real rows shifts nothing. A node replaces that default; `false`
   * renders no placeholder at all.
   *
   * Only the *first* load is held this way. A refetch that already has rows
   * keeps them and marks the region busy instead — replacing populated rows with
   * shimmer on every pagination click is a grey flash, not a loading state.
   */
  skeleton?: boolean | ReactNode;
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
  items: ReadonlyArray<TEntity>;
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

  /**
   * Picks a row instead of navigating to it — how a link picker reuses this
   * table as its browse dialog.
   *
   * Takes precedence over {@link hrefFor}: inside a picker the user is choosing
   * a value, and offering to navigate away from the form they are editing is the
   * wrong affordance. Either one renders the actions column.
   */
  onSelect?: (item: TEntity) => void;

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

  /**
   * The rows a collection-bound action would act on.
   *
   * **Controlled from above the table**, exactly as `filtering` and `sorting`
   * are, and for the same reason plus one more: a selection has to survive
   * pagination, and the page owns the pager. A selection held inside the table
   * would be reset by the very navigation the user performs to add to it.
   *
   * Omit it and no selection column is rendered — a listing that is only read
   * gains nothing from a column of empty boxes.
   */
  selection?: EntitySelection<TEntity>;
  onSelectionChange?: (selection: EntitySelection<TEntity>) => void;

  /**
   * What this caller may do with the entity, as the service decided it.
   *
   * The same document `EntityForm` takes. The table reads only the
   * `collection`-bound half of `useCases` — the entity-bound verbs belong to a
   * record, and a row's own overflow menu is fed from the
   * `context-dependent` ones.
   *
   * Absent keeps the pre-ADR-0026 behaviour: no bulk bar and no row menu, which
   * is what every un-migrated call site renders today.
   */
  metadata?: EntityMetadataDocument;
  isMetadataLoading?: boolean;

  /** Runs a `collection`-bound verb over {@link selection}. */
  onBulkUseCase?: (key: string, selection: EntitySelection<TEntity>) => void;
  /** Runs an `entity`-bound, `context-dependent` verb on one row. */
  onUseCase?: (key: string, item: TEntity) => void;

  /** The outcome of the last bulk run, rendered per row until dismissed. */
  bulkOutcomes?: readonly BulkOutcome[];
  onBulkDismiss?: () => void;
  onBulkRetry?: (ids: EntityId[]) => void;
  /** A bulk run is in flight — every verb is disabled while it is. */
  isBulkRunning?: boolean;

  /** Customization slots — see `entity-table-slots`. */
  children?: ReactNode;
}
