'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { SettlementAdapters } from './client-types';

const SettlementContext = createContext<SettlementAdapters | undefined>(
  undefined,
);

export interface SettlementProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam an e2e mock profile uses. */
  adapters?: SettlementAdapters;
}

/**
 * Provides the settlement adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages, and passes nothing:
 * building the adapters here rather than in the host keeps the composition root
 * with the shell that knows which backend answers, and gives a test somewhere
 * to substitute. `SystemManagementProvider` is the same arrangement.
 */
export function SettlementProvider({
  children,
  adapters,
}: SettlementProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <SettlementContext.Provider value={value}>
      {children}
    </SettlementContext.Provider>
  );
}

export function useSettlementAdapters(): SettlementAdapters {
  const adapters = useContext(SettlementContext);
  if (adapters === undefined) {
    throw new Error(
      'useSettlementAdapters must be used inside <SettlementProvider>',
    );
  }
  return adapters;
}
