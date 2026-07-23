'use client';

import { type BreadcrumbItem, Breadcrumbs } from '@r10c/entifix-react-controls';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface BackOfficeBreadcrumbsProps {
  /** Map a path segment to a label; unmapped segments are title-cased. */
  labels?: Record<string, string>;
  /** Label for the root crumb (href `/`). */
  homeLabel?: string;
}

function humanize(segment: string): string {
  return segment.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Derives the crumb trail from a pathname. Exported for unit testing. */
export function buildCrumbs(
  pathname: string,
  labels: Record<string, string>,
  homeLabel: string,
): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [{ label: homeLabel, href: '/' }];
  let href = '';
  for (const segment of pathname.split('/').filter(Boolean)) {
    href += `/${segment}`;
    crumbs.push({ label: labels[segment] ?? humanize(segment), href });
  }
  // The last crumb is the current page: drop its href so it renders as such.
  const last = crumbs[crumbs.length - 1];
  last.href = undefined;
  return crumbs;
}

export function BackOfficeBreadcrumbs({
  labels = {},
  homeLabel = 'Home',
}: BackOfficeBreadcrumbsProps) {
  const pathname = usePathname() ?? '/';
  const items = buildCrumbs(pathname, labels, homeLabel);

  return (
    <Breadcrumbs
      items={items}
      renderLink={item => <Link href={item.href}>{item.label}</Link>}
    />
  );
}
