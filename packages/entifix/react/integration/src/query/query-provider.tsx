'use client';

import {
  QueryClient,
  type QueryClientConfig,
  QueryClientProvider,
} from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

/**
 * A `QueryClient` tuned for the entity data layer: server data is cached and
 * served stale-while-revalidate (so a revisited list paints from cache with no
 * spinner), and failed queries surface their {@link EntifixError} immediately
 * rather than being retried behind a spinner.
 */
export function makeQueryClient(config?: QueryClientConfig): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      ...config?.defaultOptions,
      queries: {
        staleTime: 30_000,
        retry: false,
        refetchOnWindowFocus: false,
        ...config?.defaultOptions?.queries,
      },
    },
  });
}

export interface EntifixQueryProviderProps {
  children: ReactNode;
  /** Inject a client (tests, SSR); otherwise one stable client is created. */
  client?: QueryClient;
}

/**
 * Mounts the entity data layer's `QueryClient`. Mount once at the app root,
 * above the adapters provider. Holding the client in `useState` keeps a single
 * instance across renders without recreating it (which would drop the cache).
 */
export function EntifixQueryProvider({
  children,
  client,
}: EntifixQueryProviderProps) {
  const [queryClient] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
