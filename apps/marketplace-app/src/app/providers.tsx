'use client';

// Installs r10c's catalogs into the i18next binding. Importing is the act.
import '@r10c/i18n-catalog';

import type { Locale } from '@entifix/core';
import { I18nProvider } from '@entifix/react-controls/i18next';
import {
  type ThemeOption,
  ThemeProvider,
  useT,
} from '@entifix/react-controls/primitives';
import { type PropsWithChildren, useMemo } from 'react';

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 *
 * The storefront's own brand set (values in ./themes.css), distinct from admin's.
 */
function ThemedProviders({ children }: PropsWithChildren) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'marketplace', label: t('themes.marketplace') },
      { id: 'marketplace-dark', label: t('themes.marketplaceDark') },
    ],
    [t],
  );

  return (
    <ThemeProvider
      themes={themes}
      defaultTheme="marketplace"
      storageKey="r10c-marketplace-theme"
    >
      {children}
    </ThemeProvider>
  );
}

export function Providers({
  locale,
  children,
}: PropsWithChildren<{ locale: Locale }>) {
  return (
    <I18nProvider locale={locale}>
      <ThemedProviders>{children}</ThemedProviders>
    </I18nProvider>
  );
}
