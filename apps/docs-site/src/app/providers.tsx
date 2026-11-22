'use client';

import '../i18n';

import { DocsRoot } from '@entifix/docs-engine/ui';
import { type ThemeOption, useT } from '@entifix/react-controls';
import { I18nProvider } from '@entifix/react-controls/i18next';
import { type PropsWithChildren, useMemo } from 'react';

import type { SiteLocale } from '../content/copy';
import { DARK_PALETTES } from '../theme';

/** Below `I18nProvider`, so the theme captions resolve. */
function Root({ locale, children }: PropsWithChildren<{ locale: SiteLocale }>) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'aurora', label: t('themes.aurora') },
      { id: 'midnight', label: t('themes.midnight') },
    ],
    [t],
  );
  return (
    <DocsRoot
      locale={locale}
      themes={themes}
      defaultTheme="aurora"
      darkPalettes={DARK_PALETTES}
      searchIndexUrl="/pagefind/"
    >
      {children}
    </DocsRoot>
  );
}

export function Providers({
  locale,
  children,
}: PropsWithChildren<{ locale: SiteLocale }>) {
  return (
    <I18nProvider locale={locale}>
      <Root locale={locale}>{children}</Root>
    </I18nProvider>
  );
}
