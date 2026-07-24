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
    <HuiMenu as="div" className={cn('relative inline-block text-left', className)}>
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
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
        'absolute right-0 z-50 mt-2xs min-w-[12rem] rounded-lg border border-border bg-surface-elevated p-3xs shadow-lg',
        'focus:outline-none',
        className,
      )}
    >
      {children}
    </MenuItems>
  );
}

function Item({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return (
    <HuiMenuItem
      as="button"
      className={cn(
        'flex w-full items-center gap-2xs rounded-md px-2xs py-3xs text-step-sm text-content',
        'data-focus:bg-surface data-focus:text-content',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

Menu.Trigger = Trigger;
Menu.Items = Items;
Menu.Item = Item;
