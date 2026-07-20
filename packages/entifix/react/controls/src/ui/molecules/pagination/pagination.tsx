'use client';

import { Button } from '../../atoms/button';
import { Select } from '../../atoms/field';
import { Text } from '../../atoms/text';
import { cn } from '../../utils/cn';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface PaginationProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/** Page stepper plus an optional page-size selector. */
export function Pagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2xs',
        className,
      )}
    >
      <Text step={-1} tone="muted">
        Page {currentPage} of {totalPages} · {totalItems} items
      </Text>

      <div className="flex items-center gap-2xs">
        {onPageSizeChange && (
          <label className="flex items-center gap-3xs text-step-sm text-content-muted">
            Rows
            <Select
              value={pageSize}
              onChange={event => onPageSizeChange(Number(event.target.value))}
            >
              {pageSizeOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
