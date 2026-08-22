'use client';

import {
  type Entity,
  type EntitySorting,
  extractMetaEntity,
  type FilterGroup,
} from '@r10c/entifix-ts-core';
import { Fragment, type ReactNode, useState } from 'react';

import { useErrorMessage, useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
import { Skeleton } from '../../atoms/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableMessageRow,
  TableRow,
} from '../../atoms/table';
import { Link } from '../../atoms/text';
import { ColumnSettings } from '../../molecules/column-settings';
import { EntityRecordCard } from '../../molecules/entity-record-card';
import { FilterBuilder } from '../../molecules/filter-builder';
import { Pagination } from '../../molecules/pagination';
import { SortBuilder } from '../../molecules/sort-builder';
import { TableToolbar } from '../../molecules/table-toolbar';
import type {
  EntityTableColumn,
  EntityTablePivotBreakpoint,
  EntityTableProps,
} from './entity-table.types';
import { readEntityTableSlots } from './entity-table-slots';
import { useEntityTableColumns } from './use-entity-table-columns';

/**
 * The grid and the card list are both rendered, and CSS picks one. A JS
 * breakpoint hook would have to guess during SSR and correct after mount —
 * a hydration mismatch on every page load. Classes are written out in full
 * because Tailwind cannot see a class name that is concatenated at runtime.
 */
const PIVOT_CLASS: Record<
  EntityTablePivotBreakpoint,
  { grid: string; cards: string }
> = {
  sm: { grid: 'hidden sm:block', cards: 'sm:hidden' },
  md: { grid: 'hidden md:block', cards: 'md:hidden' },
  lg: { grid: 'hidden lg:block', cards: 'lg:hidden' },
};

type Panel = 'none' | 'filters' | 'sorting';

/**
 * How many placeholder rows the built-in skeleton draws.
 *
 * The column count is taken from the real geometry, because that is the axis a
 * mismatch shifts; the row count is capped instead of tracking `pageSize`, since
 * a fifty-row page would otherwise paint fifty shimmer rows to stand in for
 * content that arrives below the fold anyway.
 */
const SKELETON_ROW_CAP = 5;

/**
 * A table that builds itself from an entity's metadata: columns, labels, value
 * formatting and the filter/sort controls all come from `@accessor()`
 * declarations, so listing a new entity needs no bespoke table.
 *
 * Three things layer on top of that default:
 * - **personalization** — column order and visibility, persisted through the
 *   UI-preferences port (so it survives reloads and can later move server-side);
 * - **responsiveness** — below `pivotBreakpoint` rows pivot into label/value
 *   cards instead of scrolling sideways;
 * - **slots** — `<EntityColumn>` / `<EntityTableHeader>` / `<EntityTableRow>` /
 *   `<EntityTableToolbar>` children override any part of the default rendering.
 */
export function EntityTable<TEntity extends Entity>({
  entityConstructor,
  isLoading,
  skeleton = true,
  error,
  items,
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  hrefFor,
  newHref,
  onSelect,
  preferencesKey,
  showControls = true,
  pivotBreakpoint = 'md',
  filtering,
  sorting,
  onFilteringChange,
  onSortingChange,
  children,
}: EntityTableProps<TEntity>) {
  const t = useT();
  const errorMessage = useErrorMessage();
  const metaEntity = extractMetaEntity(entityConstructor);
  const slots = readEntityTableSlots<TEntity>(children);
  const [panel, setPanel] = useState<Panel>('none');

  const { columns, visibleColumns, hidden, setPersonalization } =
    useEntityTableColumns<TEntity>(
      entityConstructor,
      slots.columns,
      items[0],
      `entity-table:${preferencesKey ?? metaEntity.key ?? metaEntity.name}`,
    );

  const pivot = PIVOT_CLASS[pivotBreakpoint];
  const hasRowAction = onSelect !== undefined || hrefFor !== undefined;
  const columnCount = visibleColumns.length + (hasRowAction ? 1 : 0);

  /**
   * The first load has nothing to show and is held with a skeleton; a refetch
   * already has rows, so it keeps them and only marks the region busy. Splitting
   * the two is what stops every pagination click flashing grey.
   */
  const isFirstLoad = isLoading && items.length === 0;
  const isRefetching = isLoading && items.length > 0;

  /** `true`/omitted → the built-in default; a node → that node; `false` → none. */
  const customSkeleton = typeof skeleton === 'boolean' ? undefined : skeleton;
  const showSkeleton = isFirstLoad && skeleton !== false;
  const skeletonRows = Array.from(
    { length: Math.min(pageSize, SKELETON_ROW_CAP) },
    (_, index) => index,
  );

  /**
   * The refetch hint, and it is deliberately the only one: rows stay readable
   * and simply dim, because a second skeleton over live data would be two
   * loading signals in one region.
   */
  const busyClass = isRefetching
    ? 'opacity-60 transition-opacity duration-200 ease-smooth'
    : '';

  const renderCell = (
    column: EntityTableColumn<TEntity>,
    item: TEntity,
  ): ReactNode =>
    column.render ? (
      column.render(item)
    ) : (
      <CellValue
        value={(item as Record<string, unknown>)[column.name]}
        descriptor={column}
      />
    );

  /**
   * Selection wins over navigation: a picker's row must set the value, not send
   * the user away from the form they came from.
   */
  const recordAction = (item: TEntity) => {
    if (onSelect) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onSelect(item)}
        >
          {t('table.select')}
        </Button>
      );
    }
    return hrefFor ? (
      <Link href={hrefFor(item.id)}>{t('table.open')}</Link>
    ) : undefined;
  };

  /**
   * "No records" is a statement about the data; after a failed load it would be
   * a lie about it. The distinction matters most to the user who is deciding
   * whether their catalog is empty or their backend is down.
   */
  const emptyMessage = error ? t('table.error') : t('table.empty');

  return (
    <div className="flex flex-col gap-s">
      {/*
        One announcement for the whole table, not one per layout. Both the grid
        and the card list are always in the DOM — CSS picks which is visible —
        so a live region inside each meant assistive tech was told twice that
        the table was loading. The shimmer itself is aria-hidden, so this is the
        only thing that carries the news.
      */}
      <span role="status" aria-live="polite" className="sr-only">
        {isFirstLoad ? t('table.loading') : ''}
      </span>

      {showControls && (
        <TableToolbar
          start={
            <>
              {newHref && <Link href={newHref}>{t('table.new')}</Link>}
              {slots.toolbar}
            </>
          }
          end={
            <>
              <Button
                type="button"
                variant={panel === 'filters' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() =>
                  setPanel(current =>
                    current === 'filters' ? 'none' : 'filters',
                  )
                }
              >
                {t('table.filters')}
              </Button>
              <Button
                type="button"
                variant={panel === 'sorting' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() =>
                  setPanel(current =>
                    current === 'sorting' ? 'none' : 'sorting',
                  )
                }
              >
                {t('table.sorting')}
              </Button>
              <ColumnSettings
                columns={columns}
                hidden={hidden}
                onChange={setPersonalization}
              />
            </>
          }
          panel={
            panel === 'filters' ? (
              <FilterBuilder<TEntity>
                descriptors={columns.filter(column => column.filterable)}
                value={filtering}
                onChange={(applied: FilterGroup<TEntity>) =>
                  onFilteringChange?.(applied)
                }
              />
            ) : panel === 'sorting' ? (
              <SortBuilder<TEntity>
                descriptors={columns.filter(column => column.sortable)}
                value={sorting}
                onChange={(applied: EntitySorting<TEntity>) =>
                  onSortingChange?.(applied)
                }
              />
            ) : undefined
          }
        />
      )}

      {/*
        Rendered once, outside both layouts, and independently of whether there
        are rows: a refetch that fails leaves the previous page on screen, and
        without this the user would read stale data as current.
      */}
      {error && (
        <p
          role="alert"
          data-testid="entity-table-error"
          className="rounded-sm border border-danger bg-danger-subtle px-s py-2xs text-step-sm text-danger"
        >
          {errorMessage(error)}
        </p>
      )}

      {/* Wide viewports: a grid. */}
      <div className={`${pivot.grid} ${busyClass}`}>
        <Table>
          <TableHead>
            {slots.header ? (
              slots.header.render(visibleColumns)
            ) : (
              <tr>
                {visibleColumns.map(column => (
                  <TableHeaderCell key={column.name}>
                    {column.header ?? column.label}
                  </TableHeaderCell>
                ))}
                {hasRowAction && (
                  <TableHeaderCell>{t('table.actions')}</TableHeaderCell>
                )}
              </tr>
            )}
          </TableHead>
          <TableBody aria-busy={isLoading || undefined}>
            {/* Skeleton rows rather than the word "Loading", and one per column
                rather than a single full-width blob: the placeholder occupies
                the real grid, so the swap to rows shifts nothing sideways.
                `TableMessageRow` is deliberately bypassed — it is one centred
                full-span cell and cannot express the geometry. */}
            {showSkeleton &&
              (customSkeleton ? (
                <TableMessageRow colSpan={columnCount}>
                  {customSkeleton}
                </TableMessageRow>
              ) : (
                skeletonRows.map(row => (
                  <TableRow key={row}>
                    {visibleColumns.map(column => (
                      <TableCell key={column.name}>
                        <Skeleton shape="line" className="w-full" />
                      </TableCell>
                    ))}
                    {hasRowAction && (
                      <TableCell>
                        <Skeleton shape="line" className="w-16" />
                      </TableCell>
                    )}
                  </TableRow>
                ))
              ))}
            {!isLoading && items.length === 0 && (
              <TableMessageRow colSpan={columnCount}>
                {emptyMessage}
              </TableMessageRow>
            )}
            {items.map((item, index) =>
              slots.row ? (
                // A Fragment carries the key without wrapping the custom row in
                // an element `<tbody>` would reject.
                <Fragment key={String(item.id ?? index)}>
                  {slots.row.render(item, visibleColumns)}
                </Fragment>
              ) : (
                <TableRow key={String(item.id ?? index)}>
                  {visibleColumns.map(column => (
                    <TableCell key={column.name}>
                      {renderCell(column, item)}
                    </TableCell>
                  ))}
                  {hasRowAction && <TableCell>{recordAction(item)}</TableCell>}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>

      {/* Narrow viewports: the same columns pivoted into cards. */}
      <div
        className={`${pivot.cards} flex flex-col gap-2xs ${busyClass}`}
        aria-busy={isLoading || undefined}
      >
        {/* The card pivot gets card-shaped placeholders, not a bare shimmer
            block: the border, radius and padding are the geometry here. */}
        {showSkeleton &&
          (customSkeleton ??
            skeletonRows.map(row => (
              <EntityRecordCard
                key={row}
                columns={visibleColumns}
                renderCell={() => <Skeleton shape="line" className="w-24" />}
              />
            )))}
        {!isLoading && items.length === 0 && (
          <p className="text-step-sm text-content-muted">{emptyMessage}</p>
        )}
        {items.map((item, index) => (
          <EntityRecordCard
            key={String(item.id ?? index)}
            columns={visibleColumns}
            // The card is handed the resolved columns themselves, so the
            // narrow layout goes through the exact same renderers as the grid.
            renderCell={column =>
              renderCell(column as EntityTableColumn<TEntity>, item)
            }
            actions={recordAction(item)}
          />
        ))}
      </div>

      <Pagination
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalItems}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />

      {slots.rest}
    </div>
  );
}
