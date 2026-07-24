import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

export type SkeletonShape = 'line' | 'block' | 'circle';

export interface SkeletonProps extends ComponentPropsWithoutRef<'div'> {
  /** `line` for text, `block` for panels, `circle` for avatars. */
  shape?: SkeletonShape;
}

/**
 * A loading placeholder. Pulses to read as "content is coming", holds still for
 * `prefers-reduced-motion`, and is `aria-hidden` so assistive tech skips it. Its
 * dimensions come from the caller (`className` / `style`) so it matches the real
 * content's geometry and the swap causes no layout shift.
 */
export function Skeleton({ shape = 'block', className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={cn(
        'animate-pulse bg-border/60 motion-reduce:animate-none',
        shape === 'line' && 'h-[1em] rounded-full',
        shape === 'block' && 'rounded-md',
        shape === 'circle' && 'aspect-square rounded-full',
        className,
      )}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of shimmer lines; the last is shortened like a paragraph end. */
  lines?: number;
  className?: string;
}

/** A stack of line skeletons standing in for a block of text. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn('flex flex-col gap-2xs', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          shape="line"
          className={index === lines - 1 ? 'w-2/3' : 'w-full'}
        />
      ))}
    </div>
  );
}
