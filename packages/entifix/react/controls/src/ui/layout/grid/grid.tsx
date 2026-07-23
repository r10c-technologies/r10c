import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
} from 'react';

import { cn } from '../../utils/cn';
import { GAP, type SpacingToken } from '../_shared';

export interface GridProps extends ComponentPropsWithoutRef<'div'> {
  /** Minimum column width before wrapping (defaults to the --grid-min token). */
  min?: string;
  gap?: SpacingToken;
  as?: ElementType;
}

/**
 * The single CSS-Grid escape hatch in a flex-first kit: auto-fill responsive
 * columns for card grids, each at least `min` wide.
 */
export function Grid({
  min,
  gap = 'm',
  as: Tag = 'div',
  className,
  style,
  ...props
}: GridProps) {
  return (
    <Tag
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(var(--_grid-min,16rem),100%),1fr))]',
        GAP[gap],
        className,
      )}
      style={min ? ({ ...style, '--_grid-min': min } as CSSProperties) : style}
      {...props}
    />
  );
}
