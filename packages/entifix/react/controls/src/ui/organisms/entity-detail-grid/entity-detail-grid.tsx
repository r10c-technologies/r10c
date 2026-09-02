'use client';

import {
  describeChildColumns,
  editableChildColumns,
  type EntityFieldDescriptor,
  type EntityRowDraft,
  newRowKey,
  parseRowFieldPath,
  ROW_KEY,
  rowFieldPath,
} from '@r10c/entifix-ts-core';
import { type KeyboardEvent, useId, useMemo } from 'react';

import { useLocalizedDescriptors, useT } from '../../../i18n';
import { Button } from '../../atoms/button';
import { FieldControl } from '../../atoms/field-control';
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
import { Stack } from '../../molecules/stack';
import { cn } from '../../utils/cn';
import type { EntityDetailGridProps } from './entity-detail-grid.types';

/** Rows the placeholder stands in for. Enough to read as a grid, not a page. */
const SKELETON_ROW_COUNT = 3;

/**
 * The rows a record **owns**, edited in place.
 *
 * A `composition` — an order and its lines — where the rows have no life outside
 * the master and go out in the same write
 * ([ADR 0034](../../../../../../../docs/adr/0034-composition-metadata.md)). Not
 * a `linkCollection`, which is association to records that exist on their own
 * and save separately; that editor is still #26.
 *
 * ## Why this is not `EntityTable`
 *
 * `EntityTable` is a *server* listing: pages, RSQL filtering and sorting,
 * column personalization, a selection model and a bulk bar. A detail grid has
 * none of those and cannot have them — its rows are local, unsaved, and
 * unqueryable by construction, since a collection member is never `filterable`.
 * Sharing the organism would mean every one of those features growing a
 * "detail" branch. It shares the `Table` **atoms** instead, which is the level
 * the two actually have in common.
 *
 * ## Inline cells, and why Enter is free
 *
 * Each cell is a {@link FieldControl}, the same descriptor→input map the form
 * uses, so a child's `enum` gets a select and its `date` a date input with no
 * code here. `Tab` walks the row natively and crosses into the next; `Enter` on
 * the last row appends and focuses the new row's first cell.
 *
 * That last binding is available only because `EntityForm` renders a `<Card>`
 * with a `<button onClick>` Save rather than a `<form>` — inside a real form,
 * `Enter` in a text input submits, and appending a row would fight the browser
 * for it. Wrapping the form in a `<form>` element later would break this, which
 * is the one thing worth knowing before doing it.
 *
 * ## Errors
 *
 * A cell carries `aria-invalid` and points at its own message; the grid carries
 * **one** summary above it, which is the only `role="alert"` in the component.
 * A live region per cell would announce the whole grid on every keystroke, and
 * a message rendered only in the cell is unreachable when the failing row is
 * scrolled out — which is the case #110 names.
 */
export function EntityDetailGrid({
  descriptor,
  rows,
  onRowsChange,
  errors,
  editing = false,
  isLoading = false,
  skeleton = true,
  footer,
  className,
}: EntityDetailGridProps) {
  const t = useT();
  const gridId = useId();

  const described = useMemo(
    () =>
      descriptor.childType === undefined
        ? []
        : editableChildColumns(describeChildColumns(descriptor.childType)),
    [descriptor.childType],
  );
  const columns = useLocalizedDescriptors(described);

  // Only the messages that name *this* member. The form hands over its whole
  // error map so a record with two owned collections needs no bookkeeping at
  // the call site, and a grid that filtered nothing would show the other's.
  const rowErrors = useMemo(
    () => readRowErrors(descriptor.name, errors),
    [descriptor.name, errors],
  );

  const showSkeleton = isLoading && skeleton !== false;
  const customSkeleton = typeof skeleton === 'boolean' ? undefined : skeleton;
  // One more than the columns: every row carries its remove control.
  const columnCount = columns.length + (editing ? 1 : 0);

  const setRow = (index: number, member: string, value: string) => {
    onRowsChange(
      rows.map((row, position) =>
        position === index ? { ...row, [member]: value } : row,
      ),
    );
  };

  const firstColumn = columns[0]?.name;

  const appendRow = () => {
    onRowsChange([...rows, seedEmptyRow(columns)]);
    focusCell(gridId, rows.length, firstColumn);
  };

  const removeRow = (index: number) => {
    onRowsChange(rows.filter((_row, position) => position !== index));
    // Focus the row that slid into this position, or the one above it when the
    // removed row was last — never nothing, which drops the user to the page.
    focusCell(gridId, Math.min(index, rows.length - 2), firstColumn);
  };

  /**
   * `Enter` anywhere in the **last row** appends the next one.
   *
   * Bound to the row rather than to its final cell, which is what it looked
   * like it should be: the last *column* is whatever the child declared last,
   * and a read-only member there renders a disabled input that never receives a
   * key at all — so the binding would exist and be unreachable, on exactly the
   * entities that have a computed column. The row is the unit the user is
   * finishing anyway.
   *
   * Only from a text input: a `<select>` opens on Enter and a checkbox toggles
   * on Space, so taking the key from those would break a control's own
   * behaviour to add a row the user did not ask for. A read-only column needs
   * no test of its own — its input is `disabled`, so it never takes focus and
   * never raises a key here at all.
   */
  const onLastRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter') return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    appendRow();
  };

  return (
    <Stack gap="2xs" className={className}>
      <div className="flex items-center justify-between gap-s">
        <span className="text-step-sm font-medium text-content-muted">
          {descriptor.label}
        </span>
        {editing && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={appendRow}
            disabled={isLoading}
          >
            {t('detail.addRow')}
          </Button>
        )}
      </div>

      {editing && rowErrors.size > 0 && (
        <div role="alert" className="text-step-sm text-danger">
          {t('detail.errorSummary', { count: rowErrors.size })}
        </div>
      )}

      <Table
        aria-label={descriptor.label}
        aria-busy={isLoading || undefined}
        aria-rowcount={rows.length}
      >
        <TableHead>
          <TableRow>
            {columns.map(column => (
              <TableHeaderCell
                key={column.name}
                id={`${gridId}-${column.name}`}
              >
                {column.label}
              </TableHeaderCell>
            ))}
            {editing && (
              <TableHeaderCell align="end">
                <span className="sr-only">{t('detail.rowActions')}</span>
              </TableHeaderCell>
            )}
          </TableRow>
        </TableHead>

        <TableBody>
          {showSkeleton
            ? (customSkeleton ?? (
                <SkeletonRows
                  columns={columns.length}
                  extra={editing ? 1 : 0}
                />
              ))
            : rows.map((row, index) => (
                <TableRow
                  key={row[ROW_KEY]}
                  onKeyDown={
                    editing && index === rows.length - 1
                      ? onLastRowKeyDown
                      : undefined
                  }
                >
                  {columns.map(column => {
                    const error = rowErrors.get(
                      rowFieldPath(descriptor.name, index, column.name),
                    );
                    const cellId = `${gridId}-${index}-${column.name}`;
                    return (
                      <TableCell key={column.name}>
                        {editing ? (
                          <FieldControl
                            descriptor={column}
                            value={row[column.name] ?? ''}
                            id={cellId}
                            aria-labelledby={`${gridId}-${column.name}`}
                            aria-invalid={error !== undefined || undefined}
                            aria-describedby={
                              error === undefined
                                ? undefined
                                : `${cellId}-error`
                            }
                            onChange={next => setRow(index, column.name, next)}
                          />
                        ) : (
                          <span>{row[column.name] ?? ''}</span>
                        )}
                        {editing && error !== undefined && (
                          <span
                            id={`${cellId}-error`}
                            className="mt-3xs block text-step-sm text-danger"
                          >
                            {error}
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                  {editing && (
                    <TableCell align="end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeRow(index)}
                      >
                        {t('detail.removeRow', { row: index + 1 })}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}

          {!showSkeleton && rows.length === 0 && (
            <TableMessageRow colSpan={Math.max(columnCount, 1)}>
              {t('detail.empty')}
            </TableMessageRow>
          )}
        </TableBody>
      </Table>

      {footer !== undefined && !showSkeleton && (
        <div className={cn('flex justify-end text-step-sm text-content')}>
          {footer(rows)}
        </div>
      )}
    </Stack>
  );
}

/** The placeholder, shaped like the grid it stands in for. */
function SkeletonRows({ columns, extra }: { columns: number; extra: number }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_row, index) => (
        <TableRow key={index}>
          {Array.from({ length: columns + extra }, (_cell, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-8 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/**
 * A blank row, seeded with every column the grid edits.
 *
 * Every member is present and empty rather than absent, for the reason a form's
 * seed carries every key: a control handed `undefined` flips from controlled to
 * uncontrolled the moment the user types into it.
 */
function seedEmptyRow(
  columns: readonly EntityFieldDescriptor[],
): EntityRowDraft {
  const row: EntityRowDraft = { [ROW_KEY]: newRowKey() };
  for (const column of columns) row[column.name] = '';
  return row;
}

/**
 * Moves focus into a cell after the list changed.
 *
 * By element id rather than through a ref into the `<tbody>`, because the row
 * being focused does not exist yet when this is called — it is the row the
 * caller has just asked React to render. Deferring to a microtask lets that
 * render commit first; `getElementById` then finds the input the same way the
 * cell's own `aria-describedby` does.
 *
 * A row index that names nothing simply focuses nothing, which is the right
 * outcome for removing the only row: there is no cell to land in, and stealing
 * focus somewhere arbitrary is worse than leaving it where the user put it.
 */
function focusCell(gridId: string, index: number, column?: string): void {
  if (column === undefined || index < 0) return;

  queueMicrotask(() => {
    document.getElementById(`${gridId}-${index}-${column}`)?.focus();
  });
}

/** The messages naming a row of `member`, keyed by their full path. */
function readRowErrors(
  member: string,
  errors: Record<string, string> | undefined,
): Map<string, string> {
  const found = new Map<string, string>();
  if (errors === undefined) return found;

  for (const [path, message] of Object.entries(errors)) {
    if (parseRowFieldPath(path)?.member === member) found.set(path, message);
  }
  return found;
}
