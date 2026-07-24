'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { ReactiveChannel } from './reactive-channel';

/**
 * Subscribe the query cache to a {@link ReactiveChannel}: when the server
 * reports an entity changed, invalidate every cached query for that entity so
 * the visible lists refetch. The key prefix `['entity', <name>]` matches
 * {@link entityQueryKey}, so one event refreshes all pages/filters of the entity
 * without touching unrelated caches. Optimistic writes settle the same way.
 */
export function useReactiveInvalidation(channel: ReactiveChannel): void {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      channel.subscribe(event => {
        void queryClient.invalidateQueries({
          queryKey: ['entity', event.entity],
        });
      }),
    [channel, queryClient],
  );
}
