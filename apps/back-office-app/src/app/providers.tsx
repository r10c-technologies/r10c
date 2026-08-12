'use client';

import {
  I18nProvider,
  makeIndexedDbUiPreferencesState,
  type ThemeOption,
  type ThemePalette,
  ThemeProvider,
  UiPreferencesProvider,
  useT,
} from '@r10c/entifix-react-controls';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import type { Locale } from '@r10c/entifix-ts-i18n';
import {
  createClientAdapters,
  MarketplaceAdminAdaptersProvider,
} from '@r10c/shells-next-marketplace-admin';
import { SystemManagementProvider } from '@r10c/shells-next-system-management';
import { type PropsWithChildren, useMemo } from 'react';

const RUNTIME_PALETTES: Record<string, ThemePalette> = {
  ocean: {
    surface: '#eef6f7',
    'surface-elevated': '#ffffff',
    content: '#0d2b30',
    'content-muted': '#4a6b70',
    primary: '#0e8a8f',
    'primary-content': '#ffffff',
    border: '#cbe4e6',
    accent: '#0f6f8c',
  },
};

// One IndexedDB-backed preferences store for the app lifetime — module-level so
// its identity is stable across renders (a fresh store each render would reopen
// the database). Unifies all persisted client UI state in IndexedDB alongside
// the tab workspace, replacing the localStorage backend.
const uiPreferencesStore = makeIndexedDbUiPreferencesState();

/**
 * Split out so the theme captions resolve against the locale `I18nProvider`
 * mounts — calling `useT` in `Providers` itself would read the fallback
 * instance, since that component sits *above* the provider it renders.
 *
 * Themes this app exposes: aurora/sunset/midnight are static CSS presets
 * (imported in global.css); "ocean" is defined only here and injected at
 * runtime — demonstrating brands not shipped as CSS (multi-tenant / dynamic).
 */
function ThemedProviders({ children }: PropsWithChildren) {
  const t = useT('controls');
  const adapters = createClientAdapters();
  const themes = useMemo<ThemeOption[]>(
    () => [
      { id: 'aurora', label: t('themes.aurora') },
      { id: 'sunset', label: t('themes.sunset') },
      { id: 'midnight', label: t('themes.midnight') },
      { id: 'ocean', label: t('themes.ocean') },
    ],
    [t],
  );

  return (
    <EntifixQueryProvider>
      <ThemeProvider
        themes={themes}
        defaultTheme="aurora"
        storageKey="r10c-admin-theme"
        palettes={RUNTIME_PALETTES}
      >
        <UiPreferencesProvider store={uiPreferencesStore}>
          <MarketplaceAdminAdaptersProvider adapters={adapters}>
            {/* The system-management shell builds its own adapters against
                config-service, so it is provided beside the catalog's rather
                than through it — the two reach different backends. */}
            <SystemManagementProvider>{children}</SystemManagementProvider>
          </MarketplaceAdminAdaptersProvider>
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
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
