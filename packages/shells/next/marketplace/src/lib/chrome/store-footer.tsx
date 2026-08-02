import { Caption } from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';

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
