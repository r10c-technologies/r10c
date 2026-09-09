'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { OrderAdapters } from './client-types';

const OrderContext = createContext<OrderAdapters | undefined>(undefined);

export interface OrderProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam an e2e mock profile uses. */
  adapters?: OrderAdapters;
}

/**
 * Provides the order adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages, and passes nothing:
 * building the adapters here rather than in the host keeps the composition root
 * with the shell that knows which backend answers, and gives a test somewhere
 * to substitute. `SystemManagementProvider` is the same arrangement.
 */
export function OrderProvider({ children, adapters }: OrderProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <OrderContext.Provider value={value}>{children}</OrderContext.Provider>
  );
}

export function useOrderAdapters(): OrderAdapters {
  const adapters = useContext(OrderContext);
  if (adapters === undefined) {
    throw new Error('useOrderAdapters must be used inside <OrderProvider>');
  }
  return adapters;
}
