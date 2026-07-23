import type { ComponentPropsWithoutRef, ElementType } from 'react';

import { cn } from '../../utils/cn';
import type { SpacingToken } from '../_shared';

// Static strings so Tailwind's scanner keeps them.
const PADDING: Record<SpacingToken, string> = {
  '3xs': 'p-3xs',
  '2xs': 'p-2xs',
  xs: 'p-xs',
  s: 'p-s',
  m: 'p-m',
  l: 'p-l',
  xl: 'p-xl',
  '2xl': 'p-2xl',
  '3xl': 'p-3xl',
};

export interface BoxProps extends ComponentPropsWithoutRef<'div'> {
  /** Fluid padding token (Utopia). */
  padding?: SpacingToken;
  as?: ElementType;
}

/** Padded container with a themed boundary and fluid padding. */
export function Box({
  padding = 'm',
  as: Tag = 'div',
  className,
  ...props
}: BoxProps) {
  return (
    <Tag
      className={cn(
        PADDING[padding],
        'rounded-md border border-border bg-surface-elevated text-content',
        className,
      )}
      {...props}
    />
  );
}
