import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../utils/cn';

export type CardProps = ComponentPropsWithoutRef<'div'>;

/** Elevated surface with themed border and fluid padding. */
export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface-elevated p-m text-content',
        'shadow-card transition-shadow duration-200 hover:shadow-lg',
        className
      )}
      {...props}
    />
  );
}
