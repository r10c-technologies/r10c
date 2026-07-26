'use client';

import {
  I18nProvider,
  type ThemeOption,
  ThemeProvider,
  useT,
} from '@r10c/entifix-react-controls';
import type { Locale } from '@r10c/entifix-ts-i18n';
import { type PropsWithChildren, useMemo } from 'react';

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 *
 * The storefront's own brand set (values in ./themes.css), distinct from admin's.
 */
function ThemedProviders({ children }: PropsWithChildren) {
  const t = useT('app');
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
