'use client';

import {
  makeIndexedDbUiPreferencesStore,
  type ThemeOption,
  type ThemePalette,
  ThemeProvider,
  UiPreferencesProvider,
} from '@r10c/entifix-react-controls';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  createClientAdapters,
  MarketplaceAdminAdaptersProvider,
} from '@r10c/shells-next-marketplace-admin';
import type { PropsWithChildren } from 'react';

// Themes this app exposes. aurora/sunset/midnight are static CSS presets
// (imported in global.css); "ocean" is defined only here and injected at
// runtime — demonstrating brands not shipped as CSS (multi-tenant / dynamic).
const THEMES: ThemeOption[] = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'ocean', label: 'Ocean (runtime)' },
];

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
const uiPreferencesStore = makeIndexedDbUiPreferencesStore();

export function Providers({ children }: PropsWithChildren) {
  const adapters = createClientAdapters();

  return (
    <EntifixQueryProvider>
      <ThemeProvider
        themes={THEMES}
        defaultTheme="aurora"
        storageKey="r10c-admin-theme"
        palettes={RUNTIME_PALETTES}
      >
        <UiPreferencesProvider store={uiPreferencesStore}>
          <MarketplaceAdminAdaptersProvider adapters={adapters}>
            {children}
          </MarketplaceAdminAdaptersProvider>
        </UiPreferencesProvider>
      </ThemeProvider>
    </EntifixQueryProvider>
  );
}
