import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export type TopBarProps = ComponentPropsWithoutRef<'header'>;

/**
 * The application top bar: a thin, recessive band carrying identity on the left
 * and actions on the right. Deliberately quiet — the workspace tab strip below
 * it is where the eye goes. Compose it from the slots: `TopBar.Brand`,
 * `TopBar.Context`, `TopBar.Actions`.
 */
export function TopBar({ className, children, ...props }: TopBarProps) {
  return (
    <header
      className={cn(
        'flex items-center gap-s border-b border-border bg-surface-elevated px-m py-2xs',
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

interface SlotProps {
  children: ReactNode;
  className?: string;
}

function Brand({ children, className }: SlotProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2xs text-step-1 font-semibold text-content',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Context({ children, className }: SlotProps) {
  return (
    <div className={cn('text-step-sm text-content-muted', className)}>
      {children}
    </div>
  );
}

/** Right-aligned cluster — search, notifications, the user menu. */
function Actions({ children, className }: SlotProps) {
  return (
    <div className={cn('ml-auto flex items-center gap-2xs', className)}>
      {children}
    </div>
  );
}

TopBar.Brand = Brand;
TopBar.Context = Context;
TopBar.Actions = Actions;
