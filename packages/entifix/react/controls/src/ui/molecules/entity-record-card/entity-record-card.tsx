import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface EntityRecordCardColumn {
  name: string;
  label: string;
}

export interface EntityRecordCardProps {
  columns: readonly EntityRecordCardColumn[];
  /** Renders one column's cell. Supplied by the caller so a card and a table
   *  row stay in agreement about custom renderers. */
  renderCell: (column: EntityRecordCardColumn) => ReactNode;
  /** Optional trailing actions (a link to the record, …). */
  actions?: ReactNode;
  className?: string;
}

/**
 * A record pivoted from a row into a label/value stack. This is the narrow
 * viewport form of a table row: at phone widths a horizontal scroll hides most
 * columns, whereas stacking keeps every visible column readable.
 */
export function EntityRecordCard({
  columns,
  renderCell,
  actions,
  className,
}: EntityRecordCardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface-elevated p-s text-content shadow-xs',
        className,
      )}
    >
      <dl className="flex flex-col gap-2xs">
        {columns.map(column => (
          <div
            key={column.name}
            className="flex items-baseline justify-between gap-2xs"
          >
            <dt className="text-step-xs tracking-wide text-content-muted uppercase">
              {column.label}
            </dt>
            <dd className="text-right text-step-sm">{renderCell(column)}</dd>
          </div>
        ))}
      </dl>
      {actions && <div className="mt-2xs flex justify-end">{actions}</div>}
    </div>
  );
}
