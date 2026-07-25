'use client';

import {
  makeIndexedDbUiPreferencesStore,
  type ThemeOption,
  ThemeProvider,
  UiPreferencesProvider,
} from '@r10c/entifix-react-controls';
import type { PropsWithChildren } from 'react';

// Storefront's own brand set (values in ./themes.css). Distinct from admin's.
const THEMES: ThemeOption[] = [
  { id: 'auth', label: 'Auth' },
  { id: 'auth-dark', label: 'Auth Dark' },
];

// Module-level so its identity is stable across renders — a fresh store each
// render would reopen the database. The back-office shell persists its sidebar
// collapse state through it.
const uiPreferencesStore = makeIndexedDbUiPreferencesStore();

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      themes={THEMES}
      defaultTheme="auth"
      storageKey="r10c-auth-theme"
    >
      <UiPreferencesProvider store={uiPreferencesStore}>
        {children}
      </UiPreferencesProvider>
    </ThemeProvider>
  );
}
