'use client';

import { ThemeProvider, type ThemeOption } from '@r10c/entifix-react-controls';
import type { PropsWithChildren } from 'react';

// Storefront's own brand set (values in ./themes.css). Distinct from admin's.
const THEMES: ThemeOption[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'marketplace-dark', label: 'Marketplace Dark' },
];

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      themes={THEMES}
      defaultTheme="marketplace"
      storageKey="r10c-marketplace-theme"
    >
      {children}
    </ThemeProvider>
  );
}
