'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { SalesAdapters } from './client-types';

const SalesContext = createContext<SalesAdapters | undefined>(undefined);

export interface SalesProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam an e2e mock profile uses. */
  adapters?: SalesAdapters;
}

/**
 * Provides the sales adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages, and passes nothing:
 * building the adapters here rather than in the host keeps the composition root
 * with the shell that knows which backends answer, and gives a test somewhere to
 * substitute.
 */
export function SalesProvider({ children, adapters }: SalesProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <SalesContext.Provider value={value}>{children}</SalesContext.Provider>
  );
}

export function useSalesAdapters(): SalesAdapters {
  const adapters = useContext(SalesContext);
  if (adapters === undefined) {
    throw new Error('useSalesAdapters must be used inside <SalesProvider>');
  }
  return adapters;
}
