'use client';

import {
  type BreadcrumbItem,
  Breadcrumbs,
  useT,
} from '@r10c/entifix-react-controls';
import { splitLocalePath } from '@r10c/entifix-ts-i18n/routing';
import { usePathname } from 'next/navigation';

import { LocaleLink } from '../i18n';

export interface BackOfficeBreadcrumbsProps {
  /** Map a path segment to an already-translated label; unmapped segments are
   *  title-cased. Hosts resolve these through `useT` — the shell has no way to
   *  know which namespace an app keeps its route names in. */
  labels?: Record<string, string>;
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
  // The locale prefix is routing, not a place — a crumb reading "Es" would be
  // both meaningless and un-navigable.
  const { rest } = splitLocalePath(pathname);
  for (const segment of rest.split('/').filter(Boolean)) {
    href += `/${segment}`;
    crumbs.push({ label: labels[segment] ?? humanize(segment), href });
  }
  // The last crumb is the current page: drop its href so it renders as such.
  const last = crumbs[crumbs.length - 1];
  last.href = undefined;
  return crumbs;
}

/**
 * The root crumb is the shell's own copy: it names the shell's `/`, not
 * anything the host app authored. Apps used to pass their brand here
 * ("Admin", "Identidad"), which duplicated what the sidebar already shows.
 */
export function BackOfficeBreadcrumbs({
  labels = {},
}: BackOfficeBreadcrumbsProps) {
  const t = useT('shell');
  const pathname = usePathname() ?? '/';
  const items = buildCrumbs(pathname, labels, t('breadcrumbs.home'));

  return (
    <Breadcrumbs
      items={items}
      renderLink={item => (
        <LocaleLink href={item.href}>{item.label}</LocaleLink>
      )}
    />
  );
}
