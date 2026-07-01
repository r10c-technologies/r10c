'use client';

import { Button as HeadlessButton } from '@headlessui/react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../utils/cn';

const button = cva(
  [
    'inline-flex items-center justify-center rounded-lg font-medium',
    'transition duration-200 ease-smooth active:scale-[0.97]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:scale-100',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-content shadow-sm hover:opacity-90 hover:shadow-card',
        secondary:
          'border border-border bg-surface-elevated text-content shadow-xs hover:border-primary hover:shadow-sm',
        ghost: 'bg-transparent text-content hover:bg-surface-elevated',
      },
      // Padding uses the fluid spacing tokens so buttons scale with the viewport.
      size: {
        sm: 'px-xs py-3xs text-step-0',
        md: 'px-s py-2xs text-step-0',
        lg: 'px-m py-xs text-step-1',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>;

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>, VariantProps<typeof button> {}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <HeadlessButton
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  );
}
