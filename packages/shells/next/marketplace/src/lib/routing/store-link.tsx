import { type Locale, localeHref } from '@entifix/core';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

/**
 * `next/link` with the active locale already on the href — the storefront's
 * counterpart to `@entifix/next-shell`'s `LocaleLink`, and a **server**
 * component where that one is a client one.
 *
 * The layering would allow reusing it (`@entifix/*` is installed rather than a
 * layer, so any project may import it). It is not reused because `LocaleLink`
 * has to be `'use client'`: the rewrite-based apps have no locale in the route
 * tree, so it reads one from context. Here the locale *is* a route param, so it
 * arrives as a prop, and every link in the storefront (nav, category strip,
 * product card) renders on the server and ships no JavaScript of its own.
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
