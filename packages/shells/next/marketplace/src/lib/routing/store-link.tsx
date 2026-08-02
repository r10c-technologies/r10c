import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * `next/link` with the active locale already on the href — the storefront's
 * counterpart to `shells-next-common`'s `LocaleLink`, and a **server**
 * component where that one is a client one.
 *
 * Two reasons it is not simply reused. `layer:shell` may not depend on
 * `layer:shell`, so this package cannot import `shells-next-common` at all; and
 * `LocaleLink` has to be `'use client'` because the rewrite-based apps have no
 * locale in the route tree, leaving it to read one from context. Here the
 * locale *is* a route param, so it arrives as a prop and every link in the
 * storefront — nav, category strip, product card — renders on the server and
 * ships no JavaScript of its own.
 *
 * `localeHref` is idempotent and leaves absolute URLs alone, so applying it at
 * every call site is safe.
 */
export type StoreLinkProps = ComponentPropsWithoutRef<typeof Link> & {
  readonly locale: Locale;
  readonly href: string;
};

export function StoreLink({ locale, href, ...props }: StoreLinkProps) {
  return <Link href={localeHref(locale, href)} {...props} />;
}
