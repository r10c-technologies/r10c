'use client';

import {
  Menu as HuiMenu,
  MenuButton,
  MenuItem as HuiMenuItem,
  MenuItems,
} from '@headlessui/react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn';

export interface MenuProps {
  children: ReactNode;
  className?: string;
}

/**
 * A dropdown menu — the user context menu in the top bar, and the tab-overflow
 * list. A thin styled wrapper over Headless UI so focus management, keyboard
 * nav, and outside-click come for free; the tokens keep it on-brand.
 */
export function Menu({ children, className }: MenuProps) {
  return (
    <HuiMenu
      as="div"
      className={cn('relative inline-block text-left', className)}
    >
      {children}
    </HuiMenu>
  );
}

function Trigger({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <MenuButton
      className={cn(
        'inline-flex items-center gap-2xs rounded-lg px-2xs py-3xs text-step-sm text-content',
        'transition duration-200 ease-smooth hover:bg-surface',
        'focus-ring',
        className,
      )}
      {...props}
    />
  );
}

function Items({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <MenuItems
      className={cn(
        'absolute right-0 z-50 mt-2xs min-w-[12rem] rounded-lg border border-border bg-surface-elevated p-3xs shadow-overlay',
        // The panel itself is a focus-managed CONTAINER, not a target: the ring
        // belongs on the item inside it. Stripping the outline here is
        // correct, and is not a missing `focus-ring`.
        'focus:outline-none',
        className,
      )}
    >
      {children}
    </MenuItems>
  );
}

/** How an entry reads: an ordinary action, or one that destroys something. */
export type MenuItemTone = 'neutral' | 'destructive';

export interface MenuItemProps extends ComponentPropsWithoutRef<'button'> {
  /**
   * `destructive` colours the entry as a deletion.
   *
   * It exists because an overflow menu is where a destructive verb ends up once
   * the visible actions are full, and a `Button` in that position would carry
   * `variant="destructive"` — a menu that cannot say the same thing makes the
   * appearance of a verb depend on how many siblings it happens to have.
   *
   * Colour is not the affordance, and must not be the only warning: a verb
   * whose descriptor carries `confirm` still asks before it fires.
   */
  tone?: MenuItemTone;
}

const ITEM_TONE_CLASS: Record<MenuItemTone, string> = {
  neutral: 'text-content data-focus:text-content',
  destructive: 'text-danger data-focus:text-danger',
};

function Item({ className, tone = 'neutral', ...props }: MenuItemProps) {
  return (
    <HuiMenuItem
      as="button"
      className={cn(
        'flex w-full items-center gap-2xs rounded-md px-2xs py-3xs text-step-sm',
        'data-focus:bg-surface',
        ITEM_TONE_CLASS[tone],
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/**
 * A navigating menu entry.
 *
 * A plain anchor rather than a router link: the entries that need this are the
 * account menu's, and those point at a different app on a different origin,
 * where a client-side transition is not an option anyway. Callers wanting an
 * in-app transition should pass their router's link through `as`-style
 * composition at the call site instead.
 */
function Link({ className, ...props }: ComponentPropsWithoutRef<'a'>) {
  return (
    <HuiMenuItem
      as="a"
      className={cn(
        'flex w-full items-center gap-2xs rounded-md px-2xs py-3xs text-step-sm text-content no-underline',
        'data-focus:bg-surface data-focus:text-content',
        className,
      )}
      {...props}
    />
  );
}

Menu.Trigger = Trigger;
Menu.Items = Items;
Menu.Item = Item;
Menu.Link = Link;
