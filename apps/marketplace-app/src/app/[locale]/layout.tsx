import '../global.css';
// ⚠️ Installs r10c's catalogs for the **server** graph — every storefront page
// renders `getServerTFor` in a server component under this layout. The client
// install in `providers.tsx` cannot stand in for it: server and client are
// separate bundles with separate module state.
import '@r10c/i18n-catalog';

import { isLocale, type Locale, locales } from '@entifix/core';
import { getServerTFor } from '@entifix/next-i18n/server';
import { storefrontOrigin } from '@r10c/shells-next-marketplace/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { fontVariables } from '../fonts';
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
 * Every locale, known without a fetch: they are r10c's own list, registered by
 * `@r10c/i18n-catalog` above. So `[locale]` is a static segment and each
 * locale's shell is prerendered at build time.
 *
 * ⚠️ **What this must never do is enumerate catalog data.** A build machine
 * has no fleet, so anything prerendered from the catalog is an empty catalog
 * with a TTL (ADR 0051). Under Cache Components that is the shell's
 * `CATALOG_CACHE` lifetime's job: too short to be prerendered, so every
 * catalog read below this layout is a hole filled at request time.
 *
 * It used to be removed outright: without Cache Components a layout's
 * `generateStaticParams` made `/search` and `/cart` static candidates, and
 * they answered `500 DYNAMIC_SERVER_USAGE`. Now their request-time reads sit
 * inside their own `loading.tsx` boundary and stream into the shell instead.
 */
export function generateStaticParams() {
  return locales().map(locale => ({ locale }));
}

/** A prefix the proxy never produces (`/de/...`, typed by hand) is a 404. */
function requireLocale(locale: string): Locale {
  if (!isLocale(locale)) notFound();
  return locale;
}

/**
 * Title and description are per-locale: they are the first thing a visitor and
 * a crawler read, so leaving them in one language would undo the rest.
 *
 * The store's name is the default title and the template's tail, so a page
 * that names itself reads "Lighting · r10c Marketplace" and one that does not
 * reads the store's name alone. `metadataBase` is what each page's relative
 * canonical and `hreflang` alternates resolve against.
 */
export async function generateMetadata({
  params,
}: LocaleParams): Promise<Metadata> {
  const t = getServerTFor(requireLocale((await params).locale), 'app');
  return {
    metadataBase: new URL(storefrontOrigin()),
    title: {
      default: t('marketplace.title'),
      template: `%s · ${t('marketplace.title')}`,
    },
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
    // No `data-density`, and no fixed-scale import: the storefront keeps the
    // fluid Utopia scale. It is read at arm's length on a phone, which is what
    // that scale is for — density is for operator work.
    <html
      lang={locale}
      data-theme="marketplace"
      className={fontVariables}
      suppressHydrationWarning
    >
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
