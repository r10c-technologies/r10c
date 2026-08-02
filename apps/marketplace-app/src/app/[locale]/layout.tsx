import '../global.css';

import { isLocale, type Locale, LOCALES } from '@r10c/entifix-ts-i18n/routing';
import { getServerTFor } from '@r10c/shells-next-i18n/server';
import { notFound } from 'next/navigation';

import { Providers } from '../providers';

/**
 * This is the app's root layout — there is no `app/layout.tsx`. Every visitor
 * path lives under a locale prefix, so the topmost layout of the only segment
 * chain that exists is the one that owns `<html>`.
 */

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

/**
 * The two prerendered copies of every static route. This is what the `[locale]`
 * segment buys and the header-based scheme could not: the locale is known at
 * build time, so the page is too.
 */
export function generateStaticParams() {
  return LOCALES.map(locale => ({ locale }));
}

/** A prefix the middleware never produces (`/de/...`, typed by hand) is a 404. */
function requireLocale(locale: string): Locale {
  if (!isLocale(locale)) notFound();
  return locale;
}

/**
 * Title and description are per-locale: they are the first thing a visitor and
 * a crawler read, so leaving them in one language would undo the rest.
 */
export async function generateMetadata({ params }: LocaleParams) {
  const t = getServerTFor(requireLocale((await params).locale), 'app');
  return {
    title: t('marketplace.title'),
    description: t('marketplace.description'),
  };
}

export default async function RootLayout({
  children,
  params,
}: LocaleParams & { children: React.ReactNode }) {
  // `lang` has to carry the locale: screen readers pick their voice from it,
  // and so does the browser's translate prompt.
  const locale = requireLocale((await params).locale);

  return (
    <html lang={locale} data-theme="marketplace" suppressHydrationWarning>
      <body>
        {/*
          `Providers` is a client component, but `children` reaches it as a
          prop — so everything below it still renders on the server.
        */}
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
