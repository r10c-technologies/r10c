'use client';

import { Button as HeadlessButton } from '@headlessui/react';
import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';
import { button, type ButtonVariantProps } from './button-recipe';

export type { ButtonSize, ButtonVariant } from './button-recipe';

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>, ButtonVariantProps {}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <HeadlessButton
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  );
}
