'use client';

import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

export type TabStripProps = ComponentPropsWithoutRef<'div'>;

/**
 * The workspace tab strip: a horizontally scrolling row of {@link Tab}s sitting
 * on the workspace surface. Presentational only — the open set, order, and
 * active tab come from the caller (the tabs store lives in the shell).
 */
export function TabStrip({ className, children, ...props }: TabStripProps) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-end gap-3xs overflow-x-auto border-b border-border bg-surface px-2xs',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** `dirty` = unsaved draft; `saving` = autosave in flight; `error` = save failed. */
export type TabState = 'idle' | 'dirty' | 'saving' | 'error';

export interface TabProps {
  label: string;
  active?: boolean;
  state?: TabState;
  onSelect?: () => void;
  onClose?: () => void;
  className?: string;
}

/**
 * One tab. The active tab lifts onto the surface (`bg-surface-elevated` +
 * `-mb-px` so its base dissolves into the content plane below — the seam), and
 * a non-idle tab shows the autosave dot: it breathes while `saving`, turns
 * `danger` on `error`. The one place the chrome gets loud, on purpose.
 */
export function Tab({
  label,
  active = false,
  state = 'idle',
  onSelect,
  onClose,
  className,
}: TabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        'group relative flex items-center gap-2xs rounded-t-md px-s py-2xs text-step-sm',
        'transition duration-200 ease-smooth',
        active
          ? '-mb-px bg-surface-elevated font-medium text-content shadow-xs'
          : 'text-content-muted hover:bg-surface-elevated/60',
        state === 'error' && 'bg-danger-subtle text-danger',
        className,
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[2px] rounded-full bg-accent"
        />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="max-w-[12rem] truncate focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {label}
      </button>
      {state !== 'idle' && (
        <span
          data-testid="tab-indicator"
          aria-hidden="true"
          className={cn(
            'size-[6px] shrink-0 rounded-full',
            state === 'error' ? 'bg-danger' : 'bg-accent',
            state === 'saving' && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      )}
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={onClose}
          className={cn(
            'ml-2xs rounded p-3xs text-content-muted opacity-0 transition',
            'hover:bg-surface hover:text-content focus:opacity-100 group-hover:opacity-100',
            active && 'opacity-100',
          )}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

export type TabAddButtonProps = ComponentPropsWithoutRef<'button'>

/** The "+" that opens a new tab. */
export function TabAddButton({ className, ...props }: TabAddButtonProps) {
  return (
    <button
      type="button"
      aria-label="Open a new tab"
      className={cn(
        'mb-3xs shrink-0 rounded-md px-2xs py-3xs text-step-sm text-content-muted',
        'transition hover:bg-surface-elevated hover:text-content',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}
