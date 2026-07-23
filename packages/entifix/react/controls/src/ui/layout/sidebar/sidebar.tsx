import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
} from 'react';

import { cn } from '../../utils/cn';
import { GAP, type SpacingToken } from '../_shared';

export interface SidebarProps extends ComponentPropsWithoutRef<'div'> {
  /** Which edge the fixed panel sits on. */
  side?: 'start' | 'end';
  /** Gap between the side and the main. `'none'` renders them flush. */
  gap?: SpacingToken | 'none';
  as?: ElementType;
}

/**
 * Two-panel layout: a fixed-width side + a fluid main that wraps below the
 * side once the main can no longer hold its minimum inline size — no media
 * query. Compose with `Sidebar.Side` and `Sidebar.Main`.
 */
function SidebarRoot({
  side = 'start',
  gap = 'm',
  as: Tag = 'div',
  className,
  ...props
}: SidebarProps) {
  return (
    <Tag
      className={cn(
        'flex flex-wrap',
        side === 'end' && 'flex-row-reverse',
        gap !== 'none' && GAP[gap],
        className,
      )}
      {...props}
    />
  );
}

export interface SidebarSideProps extends ComponentPropsWithoutRef<'div'> {
  /** Width of the fixed panel (defaults to 20rem). */
  width?: string;
  as?: ElementType;
}

function SidebarSide({
  width,
  as: Tag = 'div',
  className,
  style,
  ...props
}: SidebarSideProps) {
  return (
    <Tag
      className={cn('shrink grow basis-[var(--_side-width,20rem)]', className)}
      style={
        width ? ({ ...style, '--_side-width': width } as CSSProperties) : style
      }
      {...props}
    />
  );
}

export interface SidebarMainProps extends ComponentPropsWithoutRef<'div'> {
  /** Minimum inline size before the main wraps below the side. */
  contentMin?: string;
  as?: ElementType;
}

function SidebarMain({
  contentMin,
  as: Tag = 'div',
  className,
  style,
  ...props
}: SidebarMainProps) {
  return (
    <Tag
      className={cn(
        'min-w-[var(--_content-min,50%)] shrink grow-[999] basis-0',
        className,
      )}
      style={
        contentMin
          ? ({ ...style, '--_content-min': contentMin } as CSSProperties)
          : style
      }
      {...props}
    />
  );
}

export const Sidebar = Object.assign(SidebarRoot, {
  Side: SidebarSide,
  Main: SidebarMain,
});
