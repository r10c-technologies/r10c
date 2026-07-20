import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../utils/cn';

/** Shared shell for the interactive form controls below. */
const CONTROL_CLASS = [
  'rounded-lg border border-border bg-surface-elevated px-2xs py-3xs',
  'text-step-sm text-content',
  'transition-colors duration-200 ease-smooth',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'type'
> {
  label: string;
}

/** Checkbox with its label — the pair is always used together. */
export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2xs text-step-sm text-content',
        className,
      )}
    >
      <input type="checkbox" className="size-4 accent-primary" {...props} />
      {label}
    </label>
  );
}
