import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  ElementType,
} from 'react';

import { cn } from '../../utils/cn';
import { GAP, type SpacingToken } from '../_shared';

export interface CoverProps extends ComponentPropsWithoutRef<'div'> {
  /** Minimum block size (defaults to 100vh). */
  minHeight?: string;
  gap?: SpacingToken;
  as?: ElementType;
}

/**
 * Vertical layout with a centered principal element and optional header/footer
 * pinned to the edges. Compose with `Cover.Header`, `Cover.Main`, `Cover.Footer`.
 */
function CoverRoot({
  minHeight,
  gap = 'm',
  as: Tag = 'div',
  className,
  style,
  ...props
}: CoverProps) {
  return (
    <Tag
      className={cn(
        'flex min-h-[var(--_cover-min,100vh)] flex-col',
        GAP[gap],
        className,
      )}
      style={
        minHeight
          ? ({ ...style, '--_cover-min': minHeight } as CSSProperties)
          : style
      }
      {...props}
    />
  );
}

export interface CoverSlotProps extends ComponentPropsWithoutRef<'div'> {
  as?: ElementType;
}

function CoverHeader({ as: Tag = 'div', className, ...props }: CoverSlotProps) {
  return <Tag className={cn(className)} {...props} />;
}

function CoverMain({ as: Tag = 'div', className, ...props }: CoverSlotProps) {
  return <Tag className={cn('my-auto', className)} {...props} />;
}

function CoverFooter({ as: Tag = 'div', className, ...props }: CoverSlotProps) {
  return <Tag className={cn(className)} {...props} />;
}

export const Cover = Object.assign(CoverRoot, {
  Header: CoverHeader,
  Main: CoverMain,
  Footer: CoverFooter,
});
