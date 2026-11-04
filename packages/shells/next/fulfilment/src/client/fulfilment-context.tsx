'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { FulfilmentAdapters } from './client-types';

const FulfilmentContext = createContext<FulfilmentAdapters | undefined>(
  undefined,
);

export interface FulfilmentProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam a test substitutes at. */
  adapters?: FulfilmentAdapters;
}

/**
 * Provides the fulfilment adapters to the pages below it. A host mounts this
 * once and passes nothing, which keeps the composition root with the shell
 * that knows which backend answers.
 */
export function FulfilmentProvider({
  children,
  adapters,
}: FulfilmentProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <FulfilmentContext.Provider value={value}>
      {children}
    </FulfilmentContext.Provider>
  );
}

export function useFulfilmentAdapters(): FulfilmentAdapters {
  const adapters = useContext(FulfilmentContext);
  if (adapters === undefined) {
    throw new Error(
      'useFulfilmentAdapters must be used inside <FulfilmentProvider>',
    );
  }
  return adapters;
}
