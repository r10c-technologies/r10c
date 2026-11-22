import '../global.css';
import '../../i18n';

import { DocsHead, DocsLayout } from '@entifix/docs-engine/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { docsCopy, isSiteLocale, SITE_LOCALES } from '../../content/copy';
import { siteFor } from '../../site';
import { DARK_PALETTES, THEME_IDS } from '../../theme';
import { Providers } from '../providers';

interface Props {
  readonly children: ReactNode;
  readonly params: Promise<{ lang: string }>;
}

export const dynamicParams = false;

export const generateStaticParams = () => SITE_LOCALES.map(lang => ({ lang }));

export async function generateMetadata({ params }: Pick<Props, 'params'>) {
  const { lang } = await params;
  if (!isSiteLocale(lang)) notFound();
  const copy = docsCopy(lang);
  return {
    title: { template: `%s · ${copy.brand}`, default: copy.title },
    description: copy.description,
  };
}

/** The theme script needs ids only; the captions are the providers'. */
const THEMES = THEME_IDS.map(id => ({ id, label: id }));

/**
 * Each language is a root layout of its own, so `<html lang>` is the page's
 * language — which is what Pagefind splits its index by, so a search on an
 * English page answers English pages.
 */
export default async function LocaleLayout({ children, params }: Props) {
  const { lang } = await params;
  if (!isSiteLocale(lang)) notFound();
  return (
    <html
      lang={lang}
      data-theme="aurora"
      data-scale="fixed"
      suppressHydrationWarning
    >
      <head>
        <DocsHead
          themes={THEMES}
          defaultTheme="aurora"
          darkPalettes={DARK_PALETTES}
        />
      </head>
      <body>
        <Providers locale={lang}>
          <DocsLayout site={siteFor(lang)} title={docsCopy(lang).brand}>
            {children}
          </DocsLayout>
        </Providers>
      </body>
    </html>
  );
}
