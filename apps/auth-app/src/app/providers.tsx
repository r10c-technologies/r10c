'use client';

import { type ThemeOption,ThemeProvider } from '@r10c/entifix-react-controls';
import type { PropsWithChildren } from 'react';

// Storefront's own brand set (values in ./themes.css). Distinct from admin's.
const THEMES: ThemeOption[] = [
  { id: 'auth', label: 'Auth' },
  { id: 'auth-dark', label: 'Auth Dark' },
];

export function Providers({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      themes={THEMES}
      defaultTheme="auth"
      storageKey="r10c-auth-theme"
    >
      {children}
    </ThemeProvider>
  );
}
