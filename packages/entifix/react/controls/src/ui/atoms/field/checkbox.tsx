'use client';

import { type ComponentPropsWithoutRef, useEffect, useRef } from 'react';

import { cn } from '../../utils/cn';

export interface CheckboxProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'type'
> {
  /**
   * The visible caption. Omit it for a box whose meaning comes from where it
   * sits — a row's selection box, where the column header is the caption and
   * the row itself is the subject — and pass `aria-label` instead, so the
   * control still announces itself to a screen reader. A box with neither is
   * unlabelled.
   */
  label?: string;
  /**
   * The third state: some of the rows below are selected, but not all.
   *
   * It is a DOM **property**, not an attribute, so React cannot set it from
   * JSX — `<input indeterminate>` is silently dropped — and it has to be
   * written through a ref after render. That is the whole reason this component
   * is separate from its siblings in `field.tsx`, and the reason it carries
   * `'use client'`: those two are hook-free and stay server-renderable, because
   * the storefront's search page is a Server Component that imports `TextInput`
   * and must not pull a client boundary into a prerendered route.
   */
  indeterminate?: boolean;
}

/**
 * A checkbox, with its caption when it has one.
 *
 * Two shapes, and the difference is not cosmetic. With `label` it renders the
 * caption inside a `<label>` and the whole pair is the click target — the form
 * control every other field is. Without one it renders a bare box that takes
 * its meaning from its position, which is what a selection column needs: a
 * caption per row would repeat the column header on every line, and the row's
 * own cells are already the subject.
 */
export function Checkbox({
  label,
  className,
  indeterminate = false,
  ...props
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The effect only runs once the input is mounted, so the ref is always
    // filled here; the guard is what keeps a future refactor that renders the
    // box conditionally from throwing rather than no-op'ing.
    /* v8 ignore next */
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const box = (
    <input
      ref={ref}
      type="checkbox"
      className={cn('size-4 accent-primary', label ? undefined : className)}
      {...props}
    />
  );

  if (label === undefined) return box;

  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2xs text-step-sm text-content',
        className,
      )}
    >
      {box}
      {label}
    </label>
  );
}
