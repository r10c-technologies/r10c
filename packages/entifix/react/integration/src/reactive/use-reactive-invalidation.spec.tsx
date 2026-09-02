import type { DomainEvent, EntityChangeEvent } from '@r10c/entifix-ts-core';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  EntifixQueryProvider,
  makeQueryClient,
} from '../query/query-provider.js';
import { makeInMemoryReactiveChannel } from './reactive-channel.js';
import { useReactiveInvalidation } from './use-reactive-invalidation.js';

const change = (entity: string): DomainEvent<EntityChangeEvent> => ({
  name: 'transaction.completed',
  id: 'txn-1:completed',
  source: 'marketplace-admin',
  at: '2026-09-02T00:00:00.000Z',
  correlationId: 'txn-1',
  data: { entity, change: 'updated', id: 'w-1' },
});

describe('useReactiveInvalidation', () => {
  it('invalidates the entity scope when a change event arrives', () => {
    const client = makeQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const channel = makeInMemoryReactiveChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntifixQueryProvider client={client}>{children}</EntifixQueryProvider>
    );

    renderHook(() => useReactiveInvalidation(channel), { wrapper });

    channel.emit(change('widget'));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['entity', 'widget'] });
  });

  it('unsubscribes on unmount', () => {
    const client = makeQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const channel = makeInMemoryReactiveChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntifixQueryProvider client={client}>{children}</EntifixQueryProvider>
    );

    const { unmount } = renderHook(() => useReactiveInvalidation(channel), {
      wrapper,
    });
    unmount();

    channel.emit(change('widget'));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
