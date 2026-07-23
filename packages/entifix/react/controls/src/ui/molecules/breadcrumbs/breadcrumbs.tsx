import type { ComponentPropsWithoutRef, ReactNode } from 'react';

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
  renderLink?: (item: Required<BreadcrumbItem>) => ReactNode;
}

/** Accessible breadcrumb trail. Presentational only — no routing knowledge. */
export function Breadcrumbs({
  items,
  separator = '/',
  renderLink,
  className,
  ...props
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
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
                  renderLink(item as Required<BreadcrumbItem>)
                ) : (
                  <a
                    href={item.href}
                    className="hover:text-content hover:underline"
                  >
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
