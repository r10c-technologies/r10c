'use client';

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import type { ReactNode } from 'react';

import { Button } from '../../atoms/button';
import { cn } from '../../utils/cn';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog. A dialog with no accessible name is announced as "dialog". */
  title: ReactNode;
  /** Accessible name for the close control. */
  closeLabel: string;
  children: ReactNode;
  className?: string;
}

/**
 * An off-canvas panel anchored to the inline start of the viewport.
 *
 * Built on Headless UI's `Dialog`, like {@link ConfirmDialog} and the entity link
 * picker, so the focus trap, `Escape`, the backdrop click and focus restoration
 * to the trigger are the library's rather than four hand-written behaviours that
 * each have to be got right — and a drawer that traps focus badly is worse than
 * no drawer, because a keyboard visitor cannot leave it.
 *
 * It carries no viewport logic. *When* a drawer is the right shape is the page
 * shell's decision (`useViewportMode`); this is only the shape.
 */
export function Drawer({
  open,
  onClose,
  title,
  closeLabel,
  children,
  className,
}: DrawerProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div aria-hidden className="fixed inset-0 bg-black/40" />
      <div className="fixed inset-0 flex">
        <DialogPanel
          data-testid="drawer"
          className={cn(
            // 200ms is `--default-transition-duration`, the beat every other
            // transition in the system already uses.
            'flex w-72 max-w-[85vw] flex-col gap-m overflow-y-auto border-r border-border bg-surface-elevated p-s transition duration-200',
            className,
          )}
        >
          <DialogTitle className="flex items-center justify-between gap-2xs text-step-1 font-semibold text-content">
            {title}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <span aria-hidden="true">✕</span>
            </Button>
          </DialogTitle>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
