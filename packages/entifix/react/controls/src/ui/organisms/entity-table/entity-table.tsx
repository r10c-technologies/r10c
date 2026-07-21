'use client';

import {
  type Entity,
  type EntitySorting,
  extractMetaEntity,
  type FilterGroup,
} from '@r10c/entifix-ts-core';
import { Fragment, type ReactNode, useState } from 'react';

import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
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
  items,
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
  hrefFor,
  newHref,
  preferencesKey,
  showControls = true,
  pivotBreakpoint = 'md',
  filtering,
  sorting,
  onFilteringChange,
  onSortingChange,
  children,
}: EntityTableProps<TEntity>) {
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
  const columnCount = visibleColumns.length + (hrefFor ? 1 : 0);

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

  const recordLink = (item: TEntity) =>
    hrefFor ? <Link href={hrefFor(item.id)}>Open</Link> : undefined;

  return (
    <div className="flex flex-col gap-s">
      {showControls && (
        <TableToolbar
          start={
            <>
              {newHref && <Link href={newHref}>New</Link>}
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
                Filters
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
                Sorting
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

      {/* Wide viewports: a grid. */}
      <div className={pivot.grid}>
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
                {hrefFor && <TableHeaderCell>Actions</TableHeaderCell>}
              </tr>
            )}
          </TableHead>
          <TableBody>
            {isLoading && items.length === 0 && (
              <TableMessageRow colSpan={columnCount}>Loading…</TableMessageRow>
            )}
            {!isLoading && items.length === 0 && (
              <TableMessageRow colSpan={columnCount}>
                No records
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
                  {hrefFor && <TableCell>{recordLink(item)}</TableCell>}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </div>

      {/* Narrow viewports: the same columns pivoted into cards. */}
      <div className={`${pivot.cards} flex flex-col gap-2xs`}>
        {isLoading && items.length === 0 && (
          <p className="text-step-sm text-content-muted">Loading…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="text-step-sm text-content-muted">No records</p>
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
            actions={recordLink(item)}
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
