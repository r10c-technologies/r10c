import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface TableToolbarProps {
  /** Actions aligned to the start — titles, primary actions. */
  start?: ReactNode;
  /** Actions aligned to the end — column settings, panel toggles. */
  end?: ReactNode;
  /** Expanded panel rendered below the bar (filters, sorting). */
  panel?: ReactNode;
  className?: string;
}

/** Bar above a table: actions on one line, an optional expanded panel below. */
export function TableToolbar({
  start,
  end,
  panel,
  className,
}: TableToolbarProps) {
  return (
    <div className={cn('flex flex-col gap-2xs', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2xs">
        <div className="flex flex-wrap items-center gap-2xs">{start}</div>
        <div className="flex flex-wrap items-center gap-2xs">{end}</div>
      </div>
      {panel && (
        <div className="rounded-xl border border-border bg-surface p-s">
          {panel}
        </div>
      )}
    </div>
  );
}
