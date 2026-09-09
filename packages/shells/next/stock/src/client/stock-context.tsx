'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { StockAdapters } from './client-types';

const StockContext = createContext<StockAdapters | undefined>(undefined);

export interface StockProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam an e2e mock profile uses. */
  adapters?: StockAdapters;
}

/**
 * Provides the stock adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages, and passes nothing:
 * building the adapters here rather than in the host keeps the composition root
 * with the shell that knows which backend answers, and gives a test somewhere
 * to substitute. `SystemManagementProvider` is the same arrangement.
 */
export function StockProvider({ children, adapters }: StockProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <StockContext.Provider value={value}>{children}</StockContext.Provider>
  );
}

export function useStockAdapters(): StockAdapters {
  const adapters = useContext(StockContext);
  if (adapters === undefined) {
    throw new Error('useStockAdapters must be used inside <StockProvider>');
  }
  return adapters;
}
