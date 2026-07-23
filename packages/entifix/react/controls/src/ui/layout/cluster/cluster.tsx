import type { ComponentPropsWithoutRef, ElementType } from 'react';

import { cn } from '../../utils/cn';
import {
  ALIGN,
  type Align,
  GAP,
  JUSTIFY,
  type Justify,
  type SpacingToken,
} from '../_shared';

export interface ClusterProps extends ComponentPropsWithoutRef<'div'> {
  gap?: SpacingToken;
  justify?: Justify;
  align?: Align;
  as?: ElementType;
}

/** Horizontal group that wraps — toolbars, tag lists, button rows. */
export function Cluster({
  gap = 's',
  justify = 'start',
  align = 'center',
  as: Tag = 'div',
  className,
  ...props
}: ClusterProps) {
  return (
    <Tag
      className={cn(
        'flex flex-wrap',
        GAP[gap],
        JUSTIFY[justify],
        ALIGN[align],
        className,
      )}
      {...props}
    />
  );
}
