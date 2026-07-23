// Shared token lookups for the flex-first layout primitives (Every Layout).
// Static class strings so Tailwind's scanner keeps them; keyed by union types
// so a caller cannot escape the Utopia spacing scale. Not part of the public
// barrel — primitives import from here, consumers import the primitives.

import type { SpacingToken } from '../molecules/stack/stack';

export type { SpacingToken };

/** Fluid gap tokens → the Utopia --spacing-* scale. */
export const GAP: Record<SpacingToken, string> = {
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

export type Justify = 'start' | 'center' | 'end' | 'between';
export const JUSTIFY: Record<Justify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
};

export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export const ALIGN: Record<Align, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
};
