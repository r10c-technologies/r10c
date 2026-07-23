import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
} from 'react';

import { cn } from '../../utils/cn';
import { GAP, type SpacingToken } from '../_shared';

export interface SwitcherProps extends ComponentPropsWithoutRef<'div'> {
  /** Container width at which the row switches to a vertical stack. */
  threshold?: string;
  gap?: SpacingToken;
  as?: ElementType;
}

/**
 * Lays children out as equal-width columns, switching to a vertical stack when
 * the container is narrower than `threshold` — achieved purely with flex-basis
 * arithmetic, no media query.
 */
export function Switcher({
  threshold,
  gap = 'm',
  as: Tag = 'div',
  className,
  style,
  ...props
}: SwitcherProps) {
  return (
    <Tag
      className={cn(
        'flex flex-wrap',
        GAP[gap],
        '[&>*]:grow [&>*]:basis-[calc((var(--_threshold,30rem)_-_100%)_*_999)]',
        className,
      )}
      style={
        threshold
          ? ({ ...style, '--_threshold': threshold } as CSSProperties)
          : style
      }
      {...props}
    />
  );
}
