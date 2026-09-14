import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { Caption } from '@entifix/react-controls/primitives';

export function StoreFooter({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');

  return (
    <footer className="mt-xl border-t border-border">
      <div className="mx-auto w-full max-w-5xl px-s py-l sm:px-l">
        <Caption>{t('storefront.footer.note')}</Caption>
      </div>
    </footer>
  );
}
