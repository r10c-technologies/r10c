import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { Button, Cluster, TextInput } from '@entifix/react-controls/primitives';
import { NarrowDisclosure } from '@r10c/utils-react-ui';
import type { ReactNode } from 'react';

import { CartBadge } from '../cart/cart-badge';
import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';

/**
 * The storefront's masthead: a server component whose only client part is the
 * cart badge, which reads a cookie the prerendered HTML cannot know. The theme
 * switcher lives in the footer: at 320px the masthead has room for the store,
 * the cart, the categories and the search, and nothing a buyer needs less
 * (WCAG 1.4.10, #529).
 *
 * The search box is a plain `GET` form to the search route, so it works with
 * no script at all. It carries only the term: a new search starts with no
 * facets, the way a new question should.
 */
export interface StoreHeaderProps {
  readonly locale: Locale;
  /** The category links, streamed: see `CategoryStrip`. */
  readonly categories: ReactNode;
  readonly searchTerm?: string;
}

export function StoreHeader({
  locale,
  categories,
  searchTerm,
}: StoreHeaderProps) {
  const t = getServerTFor(locale, 'r10c');

  return (
    <header className="border-b border-border bg-surface-elevated">
      {/* The first stop on every page (WCAG 2.4.1): past the masthead, the
          search and the category links, straight to what the page is for.
          Visible only while focused. */}
      <a
        href="#content"
        className="sr-only focus-ring focus:not-sr-only focus:absolute focus:top-s focus:left-s focus:z-50 focus:rounded-md focus:bg-surface-elevated focus:px-s focus:py-2xs focus:text-content"
      >
        {t('storefront.nav.skipToContent')}
      </a>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-xs px-s py-s sm:px-l">
        <Cluster justify="between" gap="s">
          <StoreLink
            locale={locale}
            href={storePaths.home()}
            className="text-step-1 font-semibold text-primary"
          >
            {t('storefront.home.heading')}
          </StoreLink>

          <CartBadge
            href={`/${locale}${storePaths.cart()}`}
            label={t('storefront.cart.heading')}
          />
        </Cluster>

        <Cluster justify="between" gap="s">
          {/* Folded on a small screen: four or more wrapped links pushed the
              page's own content off the first screen at 320px (#529). */}
          <NarrowDisclosure summary={t('storefront.nav.catalog')}>
            <nav aria-label={t('storefront.nav.catalog')}>{categories}</nav>
          </NarrowDisclosure>

          <form
            action={`/${locale}${storePaths.search()}`}
            method="get"
            role="search"
            className="flex w-full items-center gap-2xs sm:w-auto"
          >
            <TextInput
              type="search"
              name="q"
              defaultValue={searchTerm ?? ''}
              aria-label={t('storefront.search.label')}
              placeholder={t('storefront.search.placeholder')}
            />
            <Button type="submit">{t('storefront.search.submit')}</Button>
          </form>
        </Cluster>
      </div>
    </header>
  );
}
