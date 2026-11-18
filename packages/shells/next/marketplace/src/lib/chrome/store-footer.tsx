import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Caption,
  Cluster,
  ThemeSwitcher,
} from '@entifix/react-controls/primitives';

import { storePaths } from '../routing/paths';

export function StoreFooter({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'r10c');

  return (
    <footer className="mt-xl border-t border-border">
      <div className="mx-auto w-full max-w-7xl px-s py-l sm:px-l">
        <Cluster justify="between" gap="s">
          <Cluster gap="s">
            <Caption>{t('storefront.footer.note')}</Caption>
            <a
              href={localeHref(locale, storePaths.orderFind())}
              className="text-step--1 underline"
              data-testid="footer-find-order"
            >
              {t('storefront.footer.findOrder')}
            </a>
          </Cluster>
          {/* A preference, set once: it sits here rather than in the masthead,
              which at 320px has room only for what a buyer came to do. */}
          <ThemeSwitcher />
        </Cluster>
      </div>
    </footer>
  );
}
