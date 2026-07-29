'use client';

import {
  I18nProvider,
  makeIndexedDbUiPreferencesStore,
  type ThemeOption,
  ThemeProvider,
  UiPreferencesProvider,
  useT,
} from '@r10c/entifix-react-controls';
import type { Locale } from '@r10c/entifix-ts-i18n';
import { type PropsWithChildren, useMemo } from 'react';

// Module-level so its identity is stable across renders — a fresh store each
// render would reopen the database. The back-office shell persists its sidebar
// collapse state through it.
const uiPreferencesStore = makeIndexedDbUiPreferencesStore();

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 */
function ThemedProviders({ children }: PropsWithChildren) {
  const t = useT('controls');
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'auth', label: t('themes.auth') },
      { id: 'auth-dark', label: t('themes.authDark') },
    ],
    [t],
  );

  return (
    <ThemeProvider
      themes={themes}
      defaultTheme="auth"
      storageKey="r10c-auth-theme"
    >
      <UiPreferencesProvider store={uiPreferencesStore}>
        {children}
      </UiPreferencesProvider>
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
