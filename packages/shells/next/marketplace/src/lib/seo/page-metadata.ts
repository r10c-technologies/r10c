import { defaultLocale, type Locale, locales } from '@entifix/core';
import type { Metadata } from 'next';

/**
 * The storefront's public origin, which every canonical and alternate URL is
 * resolved against (the layout's `metadataBase`).
 *
 * Read from the environment like the fleet's other addresses. The default is
 * the dev port, so a local page states a URL that resolves locally rather than
 * one that pretends to be production.
 */
export const storefrontOrigin = (): string =>
  process.env['STOREFRONT_URL'] ?? 'http://localhost:3000';

export interface PageMetadataInput {
  readonly locale: Locale;
  /** The page's path without the locale prefix: `/`, `/c/lighting`. */
  readonly path: string;
  /** The page's own title. The layout's template appends the store's name. */
  readonly title?: string;
  readonly description?: string;
}

const localized = (locale: Locale, path: string): string =>
  path === '/' ? `/${locale}` : `/${locale}${path}`;

/**
 * A page's title, description, canonical URL and language alternates.
 *
 * The canonical is the path alone, never its query: `/c/lighting?sort=newest`
 * and `/c/lighting?page=2` are the same listing to a crawler, and naming each
 * one canonical would split it into as many thin pages as there are filter
 * combinations. Every locale is an alternate of every other, and `x-default`
 * is the default locale's copy, which is where the proxy sends a visitor
 * whose language matches none.
 */
export const pageMetadata = ({
  locale,
  path,
  title,
  description,
}: PageMetadataInput): Metadata => ({
  ...(title === undefined ? {} : { title }),
  ...(description === undefined ? {} : { description }),
  alternates: {
    canonical: localized(locale, path),
    languages: {
      ...Object.fromEntries(
        locales().map(each => [each, localized(each, path)]),
      ),
      'x-default': localized(defaultLocale(), path),
    },
  },
});
