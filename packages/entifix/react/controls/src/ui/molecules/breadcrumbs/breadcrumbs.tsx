'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { useT } from '../../../i18n';
import { cn } from '../../utils/cn';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps extends Omit<
  ComponentPropsWithoutRef<'nav'>,
  'children'
> {
  items: BreadcrumbItem[];
  /** Glyph between crumbs. */
  separator?: ReactNode;
  /**
   * Optional custom link renderer for a crumb that has an `href` and is not the
   * last one — lets a Next shell inject `<Link>` for client-side navigation.
   * Falls back to a plain `<a>`.
   */
  /**
   * Routing escape hatch. It receives `className` alongside the item and must
   * spread it onto whatever it renders — the design system owns how a
   * breadcrumb link looks, including its focus ring, and a host that supplied
   * only an href silently lost both.
   */
  renderLink?: (
    item: Required<BreadcrumbItem> & { className: string },
  ) => ReactNode;
}

/** How a breadcrumb link looks, wherever it is rendered from. */
const LINK_CLASS = 'focus-ring rounded-sm hover:text-content hover:underline';

/** Accessible breadcrumb trail. Presentational only — no routing knowledge. */
export function Breadcrumbs({
  items,
  separator = '/',
  renderLink,
  className,
  ...props
}: BreadcrumbsProps) {
  const t = useT();

  return (
    <nav
      aria-label={t('breadcrumbs.label')}
      className={cn('text-step-sm text-content-muted', className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center gap-2xs">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const linkable = item.href !== undefined && !isLast;
          return (
            <li
              key={`${item.label}-${index}`}
              className="flex items-center gap-2xs"
            >
              {linkable ? (
                renderLink ? (
                  renderLink({
                    ...(item as Required<BreadcrumbItem>),
                    className: LINK_CLASS,
                  })
                ) : (
                  <a href={item.href} className={LINK_CLASS}>
                    {item.label}
                  </a>
                )
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={cn(isLast && 'font-medium text-content')}
                >
                  {item.label}
                </span>
              )}
              {!isLast && <span aria-hidden="true">{separator}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
