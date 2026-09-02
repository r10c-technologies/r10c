'use client';

import {
  emptySelection,
  EntifixLogicError,
  type Entity,
  type EntityId,
  type EntitySelection,
  type EntitySorting,
  extractMetaEntity,
  type FilterGroup,
  isSelected,
  selectionSize,
  toggleSelected,
} from '@r10c/entifix-ts-core';
import { Fragment, type ReactNode, useRef, useState } from 'react';

import { useErrorMessage, useT, useTranslateKey } from '../../../i18n';
import { OVERFLOW_GLYPH, useCasesForSurface } from '../../actions';
import { Button } from '../../atoms/button';
import { CellValue } from '../../atoms/cell-value';
import { Checkbox } from '../../atoms/field';
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
import { BulkActionBar } from '../../molecules/bulk-action-bar';
import { BulkResult } from '../../molecules/bulk-result';
import { ColumnSettings } from '../../molecules/column-settings';
import { EntityRecordCard } from '../../molecules/entity-record-card';
import { FilterBuilder } from '../../molecules/filter-builder';
import { LoadingBoundary } from '../../molecules/loading-boundary';
import { Menu } from '../../molecules/menu';
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
  selection,
  onSelectionChange,
  metadata,
  isMetadataLoading = false,
  onBulkUseCase,
  onUseCase,
  bulkOutcomes,
  onBulkDismiss,
  onBulkRetry,
  isBulkRunning = false,
  children,
}: EntityTableProps<TEntity>) {
  const t = useT();
  // A descriptor's label is a runtime catalog key — the typed gate cannot see
  // it, which is why `@r10c/i18n-check` is what catches a typo.
  const translateKey = useTranslateKey();
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

  // A picker's table is choosing *one* value; a multi-selection there would
  // offer a set to a form member that holds a single reference, and the two
  // controls would fight over the same row. This is a wiring mistake rather
  // than a state, so it costs the render — the same call `EntityForm` makes
  // for a link source aimed at a member no picker can edit.
  if (onSelect !== undefined && selection !== undefined) {
    throw new EntifixLogicError(
      'EntityTable was given both `onSelect` and `selection`. A picker picks one ' +
        'row and a selection accumulates many, so the row control cannot be both. ' +
        'Drop `selection` inside a picker, or drop `onSelect` outside one.',
    );
  }

  /**
   * The selection, or `undefined` when the table is not selectable at all.
   *
   * One value rather than a `selection` prop beside a `selectable` boolean:
   * two of them means every render site has to re-test both, and the second
   * test is unreachable — which reads as a defensive check and is really dead
   * code the coverage gate then cannot close.
   */
  const selectionState =
    selection !== undefined && onSelectionChange !== undefined
      ? selection
      : undefined;
  const selectable = selectionState !== undefined;
  const rowUseCases = useCasesForSurface('row-menu', metadata?.useCases);
  const bulkUseCases = useCasesForSurface('bulk-bar', metadata?.useCases);
  const toolbarUseCases = useCasesForSurface(
    'table-toolbar',
    metadata?.useCases,
  );
  const hasRowMenu = rowUseCases.length > 0 && onUseCase !== undefined;

  /**
   * What a `context-independent` collection verb acts on: everything the
   * current filter matches.
   *
   * Not an empty `ids` selection, which would say "no rows" — the verb is
   * available *without* a selection precisely because its subject is the
   * collection, so the honest payload is the same filter the listing is
   * showing, and the same one a "select all matching" escalation would send.
   */
  const everythingMatching: EntitySelection<TEntity> = {
    mode: 'matching',
    filtering,
    total: totalItems,
    excluded: new Set<EntityId>(),
  };

  const hasRowAction =
    onSelect !== undefined || hrefFor !== undefined || hasRowMenu;
  const columnCount =
    visibleColumns.length + (hasRowAction ? 1 : 0) + (selectable ? 1 : 0);

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
   * The row a shift-click ranges *from* — the last box the user actually
   * toggled. Held in a ref rather than state because it changes nothing on
   * screen, and re-rendering the whole table on every click to remember an
   * anchor is a cost with no visible return.
   */
  const anchorIndex = useRef<number | undefined>(undefined);

  const setSelection = (next: EntitySelection<TEntity>) =>
    onSelectionChange?.(next);

  const toggleRow = (
    index: number,
    checked: boolean,
    shiftKey: boolean,
    current: EntitySelection<TEntity>,
  ) => {
    // A shift-click extends the last toggle across the rows *on this page*, in
    // the direction the user dragged, and applies the new state to all of them.
    const from = shiftKey ? (anchorIndex.current ?? index) : index;
    const [start, end] = from <= index ? [from, index] : [index, from];

    let next = current;
    for (const row of items.slice(start, end + 1)) {
      next = toggleSelected(next, row.id, checked);
    }

    anchorIndex.current = index;
    setSelection(next);
  };

  /**
   * The header box, and it has three states rather than two: none of this
   * page's rows selected, all of them, or some. Without the third the box
   * reads as "nothing is selected" while a bulk bar sits below it saying
   * otherwise.
   */
  const pageIds = items.map(item => item.id);
  const selectedOnPage = selectionState
    ? pageIds.filter(id => isSelected(selectionState, id)).length
    : 0;
  const allOnPageSelected =
    pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  const toggleAllOnPage = (
    checked: boolean,
    current: EntitySelection<TEntity>,
  ) => {
    let next = current;
    for (const id of pageIds) next = toggleSelected(next, id, checked);
    anchorIndex.current = undefined;
    setSelection(next);
  };

  /**
   * How a row names itself to a screen reader.
   *
   * The first visible column's value, because that is what the user reads the
   * row *as* — "Seleccionar Acme" rather than "Seleccionar fila 3", which tells
   * them the position they can already see and not the thing they cannot.
   */
  const rowLabel = (item: TEntity): string => {
    // The first non-identifier column **that this row actually filled in**.
    //
    // An id names a row the way "row 3" does: it repeats what the user can
    // already see. But skipping only the id is not enough — measured against
    // the seeded catalog, where `code` is the first non-id column and is empty
    // on every brand, so the label fell straight through to the id and never
    // reached `name`. A column that is blank on this row names it no better
    // than its position does, so the search continues past it.
    //
    // The id remains the last resort, because a row with nothing rendered
    // still has to announce itself.
    const named = visibleColumns.find(column => {
      if (column.type === 'id') return false;
      const value = (item as Record<string, unknown>)[column.name];
      return value != null && String(value) !== '';
    });

    return named
      ? String((item as Record<string, unknown>)[named.name])
      : String(item.id);
  };

  const selectionCell = (
    item: TEntity,
    index: number,
    // Passed in rather than closed over: this is only ever called under
    // `selectable`, which already proves the selection exists, and reading the
    // optional prop here would add a fallback arm that nothing can reach.
    current: EntitySelection<TEntity>,
  ) => (
    <Checkbox
      // Deliberately no `id`: both pivots are always in the DOM, so an id here
      // would be emitted twice per row. `aria-label` names the control instead,
      // and it names the *record* rather than the position.
      aria-label={t('table.selectRow', { record: rowLabel(item) })}
      checked={isSelected(current, item.id)}
      disabled={isBulkRunning}
      onChange={event =>
        toggleRow(
          index,
          event.currentTarget.checked,
          (event.nativeEvent as MouseEvent).shiftKey === true,
          current,
        )
      }
    />
  );

  const rowMenu = (item: TEntity) =>
    hasRowMenu ? (
      <Menu>
        <Menu.Trigger aria-label={t('table.actions')}>
          {OVERFLOW_GLYPH}
        </Menu.Trigger>
        <Menu.Items>
          {rowUseCases.map(useCase => (
            <Menu.Item
              key={useCase.key}
              tone={
                useCase.confirm?.tone === 'destructive'
                  ? 'destructive'
                  : 'neutral'
              }
              onClick={() => onUseCase?.(useCase.key, item)}
            >
              {translateKey(useCase.labelKey)}
            </Menu.Item>
          ))}
        </Menu.Items>
      </Menu>
    ) : undefined;

  /**
   * Selection wins over navigation: a picker's row must set the value, not send
   * the user away from the form they came from.
   *
   * The row menu sits *beside* whichever of the two applies rather than
   * replacing it — "open this record" and "run a verb on it" are both true at
   * once, and folding the first into the menu would bury the action every row
   * of a list exists for.
   */
  const recordAction = (item: TEntity) => {
    const primary = onSelect ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onSelect(item)}
      >
        {t('table.select')}
      </Button>
    ) : hrefFor ? (
      <Link href={hrefFor(item.id)}>{t('table.open')}</Link>
    ) : undefined;

    const menu = rowMenu(item);
    if (!menu) return primary;

    return (
      <span className="flex items-center gap-2xs">
        {primary}
        {menu}
      </span>
    );
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
              {/* Collection-bound verbs that need no selection. They sit with
                  `New` rather than in the bulk bar, because the bulk bar only
                  exists while rows are ticked and these are always available. */}
              <LoadingBoundary isLoading={isMetadataLoading} lines={0}>
                <>
                  {toolbarUseCases.map(useCase => (
                    <Button
                      key={useCase.key}
                      type="button"
                      variant={
                        useCase.confirm?.tone === 'destructive'
                          ? 'destructive'
                          : 'secondary'
                      }
                      size="sm"
                      disabled={isBulkRunning}
                      onClick={() =>
                        onBulkUseCase?.(useCase.key, everythingMatching)
                      }
                    >
                      {translateKey(useCase.labelKey)}
                    </Button>
                  ))}
                </>
              </LoadingBoundary>
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
        The bar appears when there is something selected and something to do
        with it. It sits above the rows rather than floating over them: a fixed
        overlay covers the last row of a short page, which is the row the user
        most likely just ticked.
      */}
      {selectionState && selectionSize(selectionState) > 0 && (
        <BulkActionBar
          count={selectionSize(selectionState)}
          useCases={bulkUseCases}
          busy={isBulkRunning}
          // Offered only when this page is fully ticked and the store holds
          // more than the page — the escalation has somewhere to escalate to.
          matchingTotal={
            selectionState.mode === 'ids' &&
            allOnPageSelected &&
            totalItems > items.length
              ? totalItems
              : undefined
          }
          onSelectAllMatching={() => setSelection(everythingMatching)}
          onClear={() => setSelection(emptySelection<TEntity>())}
          onUseCase={key => onBulkUseCase?.(key, selectionState)}
        />
      )}

      {bulkOutcomes && bulkOutcomes.length > 0 && onBulkDismiss && (
        <BulkResult
          outcomes={bulkOutcomes}
          busy={isBulkRunning}
          labelFor={id => {
            const row = items.find(item => item.id === id);
            return row ? rowLabel(row) : undefined;
          }}
          onRetryFailed={onBulkRetry}
          onDismiss={onBulkDismiss}
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
                {selectable && (
                  <TableHeaderCell>
                    <Checkbox
                      aria-label={t('table.selectAllOnPage')}
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected}
                      disabled={isBulkRunning || items.length === 0}
                      onChange={event =>
                        toggleAllOnPage(
                          event.currentTarget.checked,
                          selectionState,
                        )
                      }
                    />
                  </TableHeaderCell>
                )}
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
                    {selectable && (
                      <TableCell>
                        <Skeleton shape="line" className="w-4" />
                      </TableCell>
                    )}
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
                  {selectionState && (
                    <TableCell>
                      {selectionCell(item, index, selectionState)}
                    </TableCell>
                  )}
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
            leading={
              selectionState
                ? selectionCell(item, index, selectionState)
                : undefined
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
