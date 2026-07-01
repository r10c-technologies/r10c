import { Entity } from '@r10c/entifix-ts-core';

import type { TableProps } from './table.types';

/**
 * Column names for a row. Entities deserialize into class instances whose
 * fields are exposed through accessor getters on the prototype (so
 * `Object.keys` is empty); fall back to collecting those getter names. Plain
 * objects still work through their own enumerable keys.
 */
function getColumns(item: object): string[] {
  const ownKeys = Object.keys(item);
  if (ownKeys.length > 0) {
    return ownKeys;
  }

  const columns: string[] = [];
  let proto = Object.getPrototypeOf(item);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || columns.includes(name)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      if (descriptor && typeof descriptor.get === 'function') {
        columns.push(name);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return columns;
}

/**
 * Minimal generic table with prev/next pagination. Columns are derived from the
 * first row. Intentionally unstyled — it exists to exercise the data-loading
 * flow, not to be a finished UI component.
 */
export function Table<TEntity extends Entity>({
  isLoading,
  items,
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
}: TableProps<TEntity>) {
  const columns = items.length > 0 ? getColumns(items[0] as object) : [];
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;

  return (
    <div>
      {isLoading && <div>Loading…</div>}
      <table>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={`th-${column}`} style={{ textAlign: 'left' }}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {columns.map(column => (
                <td key={`cell-${rowIndex}-${column}`}>
                  {String((item as Record<string, unknown>)[column] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          {' '}
          Page {currentPage} of {totalPages} ({totalItems} items){' '}
        </span>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
