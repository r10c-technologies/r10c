import { Cluster, Text, ThemeSwitcher } from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';

import { CartBadge } from '../cart/cart-badge';
import { storePaths } from '../routing/paths';
import { StoreLink } from '../routing/store-link';

/**
 * The storefront's masthead: a server component whose only client parts are the
 * two controls that genuinely need to be — the theme switcher, and the cart
 * badge, which reads a cookie the prerendered HTML cannot know.
 */
export interface StoreHeaderProps {
  readonly locale: Locale;
  readonly categories: ReadonlyArray<{ code: string; name: string }>;
}

export function StoreHeader({ locale, categories }: StoreHeaderProps) {
  const t = getServerTFor(locale, 'shell');

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
            <StoreLink locale={locale} href={storePaths.search()}>
              <Text muted>{t('storefront.search.heading')}</Text>
            </StoreLink>
            <CartBadge
              href={`/${locale}${storePaths.cart()}`}
              label={t('storefront.cart.heading')}
            />
            <ThemeSwitcher className="shrink-0" />
          </Cluster>
        </Cluster>

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
      </div>
    </header>
  );
}
