import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { cn } from '../../utils/cn';
import { button, type ButtonVariantProps } from './button-recipe';

/**
 * An anchor wearing {@link Button}'s clothes — and, unlike `Button`, a
 * **server** component.
 *
 * Most call-to-action buttons are not buttons: "View product", "Browse
 * category" and "Keep shopping" navigate, and a `<button>` that navigates is
 * both worse for the visitor (no middle-click, no open-in-new-tab, no status
 * bar) and more expensive for the page, because `Button` carries a
 * `'use client'` and would turn every card in a grid into its own client
 * boundary.
 *
 * Reach for `Button` when something actually happens on click; reach for this
 * when the click is a link. It takes no event handlers on purpose — accepting
 * one would quietly demand a client parent to pass it.
 */
export interface ButtonLinkProps
  extends Omit<ComponentPropsWithoutRef<'a'>, 'onClick'>, ButtonVariantProps {
  /**
   * Required: a link with no content is invisible to a screen reader and
   * unclickable to everyone else. `jsx-a11y/anchor-has-content` cannot see
   * through the prop spread below, so the type is what enforces it.
   */
  children: ReactNode;
}

export function ButtonLink({
  variant,
  size,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <a className={cn(button({ variant, size }), className)} {...props}>
      {children}
    </a>
  );
}
