'use client';

import { useLocale } from '@r10c/entifix-react-controls';
import { type Locale, localeHref, splitLocalePath } from '@r10c/entifix-ts-i18n/routing';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentPropsWithoutRef } from 'react';
import { useCallback } from 'react';

/**
 * Prefixes an in-app href with the active locale.
 *
 * Every internal link has to go through this. An unprefixed `/catalog` still
 * works — the middleware negotiates and redirects — but the visitor pays a
 * round trip and, worse, a visitor reading `/en/...` who follows a bare link
 * lands back on whatever their cookie says. The helper is idempotent and leaves
 * absolute URLs alone, so it is safe to apply at every call site.
 */
export function useLocaleHref(): (href: string) => string {
  const locale = useLocale();
  return useCallback((href: string) => localeHref(locale, href), [locale]);
}

/**
 * The locale the URL is actually on. Reads the browser path rather than the
 * provider, so it is correct inside `usePathname`-driven code (breadcrumbs)
 * even before the provider re-renders.
 */
export function usePathLocale(): Locale | undefined {
  return splitLocalePath(usePathname() ?? '/').locale;
}

export type LocaleLinkProps = ComponentPropsWithoutRef<typeof Link>;

/** `next/link` with the active locale already on the href. */
export function LocaleLink({ href, ...props }: LocaleLinkProps) {
  const withLocale = useLocaleHref();
  const resolved = typeof href === 'string' ? withLocale(href) : href;

  return <Link href={resolved} {...props} />;
}
