import '../global.css';

import { isLocale, type Locale } from '@r10c/entifix-ts-i18n/routing';
import { getServerTFor } from '@r10c/shells-next-i18n/server';
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
 * ⚠️ **Deliberately empty, and the routes below are still cached.**
 *
 * This used to return both locales, which prerendered `/es` and `/en` at build
 * time. That stopped being right the moment the storefront's content came from
 * marketplace-service: a build machine has no fleet, so what it would bake into
 * the home page is an empty catalog — and `revalidate` would then serve that
 * empty page to the first visitor of each locale after every deploy. A page
 * rendered from data the builder could not read is not a warm cache, it is a
 * wrong answer with a long TTL.
 *
 * So every locale renders on its first request and is cached from there, which
 * is the same arrangement `/[locale]/p/[offeringId]` uses and for the same
 * reason. What the `[locale]` segment buys is unchanged and is not about the
 * build: the locale is a route parameter rather than a header, so these pages
 * are cacheable at all — the header-based scheme in the back offices forces
 * every render to be dynamic.
 *
 * The function stays rather than being deleted: it is the one place the
 * decision is legible, and removing it invites the next reader to add
 * enumeration back.
 */
export function generateStaticParams() {
  return [];
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
