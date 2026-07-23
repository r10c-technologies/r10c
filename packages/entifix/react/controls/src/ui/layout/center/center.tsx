import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
} from 'react';

import { cn } from '../../utils/cn';

export interface CenterProps extends ComponentPropsWithoutRef<'div'> {
  /** Max line-length. Defaults to the --measure token; a string overrides it. */
  measure?: string;
  /** Horizontal gutters so content never touches the viewport edge. */
  gutters?: boolean;
  /** Also center the children themselves (not just the content box). */
  intrinsic?: boolean;
  as?: ElementType;
}

/** Horizontally centers content and caps its width to a readable measure. */
export function Center({
  measure,
  gutters = false,
  intrinsic = false,
  as: Tag = 'div',
  className,
  style,
  ...props
}: CenterProps) {
  return (
    <Tag
      className={cn(
        'mx-auto max-w-[var(--measure)]',
        gutters && 'px-s',
        intrinsic && 'flex flex-col items-center',
        className,
      )}
      style={
        measure ? ({ ...style, '--measure': measure } as CSSProperties) : style
      }
      {...props}
    />
  );
}
