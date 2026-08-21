import type { ReactNode } from 'react';

import { Skeleton, SkeletonText } from '../../atoms/skeleton';
import { cn } from '../../utils/cn';

export interface LoadingBoundaryProps {
  isLoading: boolean;
  children: ReactNode;
  /** What to show while loading. Defaults to a shape-matched skeleton. */
  fallback?: ReactNode;
  /** Lines for the default text fallback. `0` renders a single block instead. */
  lines?: number;
  className?: string;
  /** Announced to assistive tech; a catalog key resolved by the caller. */
  label?: string;
}

/**
 * Holds a region's shape while its content is still arriving.
 *
 * Presentational and copy-free: it renders a skeleton, not the word "Loading",
 * because a placeholder that matches the real geometry causes no layout shift
 * when the content lands and needs no translation. The optional {@link label} is
 * for screen readers only — the visual skeleton is `aria-hidden`, so without it
 * a non-sighted caller is told nothing at all while a region is pending.
 *
 * It is not an error boundary and does not catch anything. Rendering actions
 * became asynchronous when affordances moved behind `$metadata` (ADR 0026);
 * this is where that wait is shown.
 */
export function LoadingBoundary({
  isLoading,
  children,
  fallback,
  lines = 3,
  className,
  label,
}: LoadingBoundaryProps) {
  if (!isLoading) {
    return <>{children}</>;
  }

  return (
    <div
      data-testid="loading-boundary"
      className={cn(className)}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      {label && <span className="sr-only">{label}</span>}
      {fallback ??
        (lines === 0 ? (
          <Skeleton className="h-8 w-full" />
        ) : (
          <SkeletonText lines={lines} />
        ))}
    </div>
  );
}
