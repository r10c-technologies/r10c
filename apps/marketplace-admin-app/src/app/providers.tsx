'use client';

import {
  createClientAdapters,
  MarketplaceAdminAdaptersProvider,
} from '@r10c/shells-next-marketplace-admin';
import {
  ThemeProvider,
  type ThemeOption,
  type ThemePalette,
} from '@r10c/entifix-react-controls';
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

export function Providers({ children }: PropsWithChildren) {
  const adapters = createClientAdapters();

  return (
    <ThemeProvider
      themes={THEMES}
      defaultTheme="aurora"
      storageKey="r10c-admin-theme"
      palettes={RUNTIME_PALETTES}
    >
      <MarketplaceAdminAdaptersProvider adapters={adapters}>
        {children}
      </MarketplaceAdminAdaptersProvider>
    </ThemeProvider>
  );
}
