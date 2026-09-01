import './global.css';

import { getRequestLocale, getServerT } from '@r10c/shells-next-i18n/server';

import { fontVariables } from './fonts';
import { Providers } from './providers';

/**
 * Title and description are per-request now: they are the first thing a visitor
 * and a crawler read, so leaving them in one language would undo the rest.
 */
export async function generateMetadata() {
  const t = await getServerT('app');
  return { title: t('admin.title'), description: t('admin.description') };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The locale the middleware negotiated. `lang` has to carry it: screen readers
  // pick their voice from it, and so does the browser's translate prompt.
  const locale = await getRequestLocale();
  return (
    // `data-scale` and `data-density` are read by `presets/fixed-scale.css`,
    // the same way `data-theme` is read by a palette. The back office is dense
    // operator work, so it takes the fixed 4px scale and compacts it — and
    // nothing below this element knows, which is the point: a control must
    // never learn which app it runs in.
    <html
      lang={locale}
      data-theme="aurora"
      data-scale="fixed"
      data-density="compact"
      className={fontVariables}
      suppressHydrationWarning
    >
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
