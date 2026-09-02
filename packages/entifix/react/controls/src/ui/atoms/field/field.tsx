import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

/** Shared shell for the interactive form controls below. */
const CONTROL_CLASS = [
  'rounded-lg border border-border bg-surface-elevated px-2xs py-3xs',
  'text-step-sm text-content',
  'transition-colors duration-200 ease-smooth',
  'focus-ring',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ');

export function TextInput({
  className,
  ...props
}: ComponentPropsWithoutRef<'input'>) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Select({
  className,
  ...props
}: ComponentPropsWithoutRef<'select'>) {
  return <select className={cn(CONTROL_CLASS, className)} {...props} />;
}
