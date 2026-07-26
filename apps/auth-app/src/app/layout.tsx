import './global.css';

import { getRequestLocale, getServerT } from '@r10c/shells-next-i18n/server';

import { Providers } from './providers';


/**
 * Title and description are per-request now: they are the first thing a visitor
 * and a crawler read, so leaving them in one language would undo the rest.
 */
export async function generateMetadata() {
  const t = await getServerT('app');
  return { title: t('auth.title'), description: t('auth.description') };
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
    <html lang={locale} data-theme="auth" suppressHydrationWarning>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
