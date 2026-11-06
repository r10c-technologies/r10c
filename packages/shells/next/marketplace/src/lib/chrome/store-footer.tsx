import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Caption,
  Cluster,
  ThemeSwitcher,
} from '@entifix/react-controls/primitives';

export function StoreFooter({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'r10c');

  return (
    <footer className="mt-xl border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-s py-l sm:px-l">
        <Cluster justify="between" gap="s">
          <Caption>{t('storefront.footer.note')}</Caption>
          {/* A preference, set once: it sits here rather than in the masthead,
              which at 320px has room only for what a buyer came to do. */}
          <ThemeSwitcher />
        </Cluster>
      </div>
    </footer>
  );
}
