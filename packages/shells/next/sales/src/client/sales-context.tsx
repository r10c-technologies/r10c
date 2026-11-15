'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';

import { createClientAdapters } from './adapters/create-client-adapters';
import type { SalesAdapters } from './client-types';

const SalesContext = createContext<SalesAdapters | undefined>(undefined);
const SalesScopeContext = createContext<string | undefined>(undefined);

export interface SalesProviderProps {
  children: ReactNode;
  /** Overrides the real REST adapters — the seam an e2e mock profile uses. */
  adapters?: SalesAdapters;
  /**
   * Whose till this is: the host's workspace scope, principal and organization
   * together. A remembered channel is keyed by it, because a channel id is one
   * organization's and a till shared across a switch would preselect another
   * tenant's record ([ADR 0032](../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
   * Without one, nothing is remembered.
   */
  scope?: string;
}

/**
 * Provides the sales adapters to the pages below it.
 *
 * A host mounts this once, anywhere above the pages, and passes nothing:
 * building the adapters here rather than in the host keeps the composition root
 * with the shell that knows which backends answer, and gives a test somewhere to
 * substitute.
 */
export function SalesProvider({
  children,
  adapters,
  scope,
}: SalesProviderProps) {
  const value = useMemo(() => adapters ?? createClientAdapters(), [adapters]);

  return (
    <SalesContext.Provider value={value}>
      <SalesScopeContext.Provider value={scope}>
        {children}
      </SalesScopeContext.Provider>
    </SalesContext.Provider>
  );
}

/** The scope the host mounted the shell under, if it named one. */
export function useSalesScope(): string | undefined {
  return useContext(SalesScopeContext);
}

export function useSalesAdapters(): SalesAdapters {
  const adapters = useContext(SalesContext);
  if (adapters === undefined) {
    throw new Error('useSalesAdapters must be used inside <SalesProvider>');
  }
  return adapters;
}
