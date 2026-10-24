import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Button,
  Cluster,
  Text,
  TextInput,
  ThemeSwitcher,
} from '@entifix/react-controls/primitives';

import { CartBadge } from '../cart/cart-badge';
import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';

/**
 * The storefront's masthead: a server component whose only client parts are the
 * two controls that genuinely need to be — the theme switcher, and the cart
 * badge, which reads a cookie the prerendered HTML cannot know.
 *
 * The search box is a plain `GET` form to the search route, so it works with
 * no script at all. It carries only the term: a new search starts with no
 * facets, the way a new question should.
 */
export interface StoreHeaderProps {
  readonly locale: Locale;
  readonly categories: ReadonlyArray<{ code: string; name: string }>;
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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-xs px-s py-s sm:px-l">
        <Cluster justify="between" gap="s">
          <StoreLink
            locale={locale}
            href={storePaths.home()}
            className="text-step-1 font-semibold text-primary"
          >
            {t('storefront.home.heading')}
          </StoreLink>

          <Cluster gap="s">
            <CartBadge
              href={`/${locale}${storePaths.cart()}`}
              label={t('storefront.cart.heading')}
            />
            <ThemeSwitcher className="shrink-0" />
          </Cluster>
        </Cluster>

        <Cluster justify="between" gap="s">
          <nav aria-label={t('storefront.nav.catalog')}>
            <Cluster gap="s" as="ul" className="list-none p-0">
              {categories.map(category => (
                <li key={category.code}>
                  <StoreLink
                    locale={locale}
                    href={storePaths.category(category.code)}
                  >
                    <Text muted>{category.name}</Text>
                  </StoreLink>
                </li>
              ))}
            </Cluster>
          </nav>

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
