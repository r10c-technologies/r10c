'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { SystemManagementAdapters } from './client-types';

const SystemManagementContext = createContext<
  SystemManagementAdapters | undefined
>(undefined);

export interface SystemManagementProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam the e2e mock profile uses. */
  adapters?: SystemManagementAdapters;
}

/**
 * Provides the system-management adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages. Building the adapters here
 * rather than importing them per page keeps the composition root in one place and
 * gives a test somewhere to substitute.
 */
export function SystemManagementProvider({
  children,
  adapters,
}: SystemManagementProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <SystemManagementContext.Provider value={value}>
      {children}
    </SystemManagementContext.Provider>
  );
}

export function useSystemManagementAdapters(): SystemManagementAdapters {
  const adapters = useContext(SystemManagementContext);
  if (adapters === undefined) {
    throw new Error(
      'useSystemManagementAdapters must be used inside <SystemManagementProvider>',
    );
  }
  return adapters;
}
