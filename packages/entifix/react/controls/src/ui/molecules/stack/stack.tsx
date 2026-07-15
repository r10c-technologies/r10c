import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

export type SpacingToken =
  | '3xs'
  | '2xs'
  | 'xs'
  | 's'
  | 'm'
  | 'l'
  | 'xl'
  | '2xl'
  | '3xl';

// Static class strings so Tailwind's scanner keeps them.
const GAP: Record<SpacingToken, string> = {
  '3xs': 'gap-3xs',
  '2xs': 'gap-2xs',
  xs: 'gap-xs',
  s: 'gap-s',
  m: 'gap-m',
  l: 'gap-l',
  xl: 'gap-xl',
  '2xl': 'gap-2xl',
  '3xl': 'gap-3xl',
};

export interface StackProps extends ComponentPropsWithoutRef<'div'> {
  direction?: 'row' | 'column';
  /** Gap between children, from the fluid Utopia spacing scale. */
  gap?: SpacingToken;
  align?: 'start' | 'center' | 'end' | 'stretch';
  wrap?: boolean;
}

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
} as const;

/** Flex container that spaces children with a fluid spacing token. */
export function Stack({
  direction = 'column',
  gap = 'm',
  align = 'stretch',
  wrap = false,
  className,
  ...props
}: StackProps) {
  return (
    <div
      className={cn(
        'flex',
        direction === 'row' ? 'flex-row' : 'flex-col',
        GAP[gap],
        ALIGN[align],
        wrap && 'flex-wrap',
        className
      )}
      {...props}
    />
  );
}
