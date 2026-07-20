import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

export interface TableProps extends ComponentPropsWithoutRef<'table'> {
  /** Class names for the scroll container wrapping the `<table>`. */
  containerClassName?: string;
}

/**
 * Styled table primitive — no entity knowledge, no data fetching. `EntityTable`
 * composes these; anything rendering non-entity tabular data can use them too.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways.
 */
export function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto rounded-xl border border-border bg-surface-elevated',
        containerClassName,
      )}
    >
      <table
        className={cn(
          'w-full border-collapse text-step-0 text-content',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function TableHead({
  className,
  ...props
}: ComponentPropsWithoutRef<'thead'>) {
  return (
    <thead
      className={cn('border-b border-border bg-surface', className)}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: ComponentPropsWithoutRef<'tbody'>) {
  return (
    <tbody className={cn('divide-y divide-border', className)} {...props} />
  );
}

export function TableRow({
  className,
  ...props
}: ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={cn(
        'transition-colors duration-200 ease-smooth hover:bg-surface',
        className,
      )}
      {...props}
    />
  );
}

export type TableCellAlign = 'start' | 'center' | 'end';

const ALIGN_CLASS: Record<TableCellAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
};

// `align` shadows the deprecated HTML attribute, which allows a different set
// of values — omit the native one rather than narrow it.
export interface TableHeaderCellProps extends Omit<
  ComponentPropsWithoutRef<'th'>,
  'align'
> {
  align?: TableCellAlign;
}

export function TableHeaderCell({
  align = 'start',
  className,
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope="col"
      className={cn(
        'px-s py-2xs text-step-sm font-semibold whitespace-nowrap text-content-muted',
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  );
}

export interface TableCellProps extends Omit<
  ComponentPropsWithoutRef<'td'>,
  'align'
> {
  align?: TableCellAlign;
}

export function TableCell({
  align = 'start',
  className,
  ...props
}: TableCellProps) {
  return (
    <td
      className={cn('px-s py-2xs align-middle', ALIGN_CLASS[align], className)}
      {...props}
    />
  );
}

/** Full-width message row — empty results, an error, a loading state. */
export function TableMessageRow({
  colSpan,
  className,
  ...props
}: ComponentPropsWithoutRef<'td'> & { colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          'px-s py-m text-center text-step-sm text-content-muted',
          className,
        )}
        {...props}
      />
    </tr>
  );
}
