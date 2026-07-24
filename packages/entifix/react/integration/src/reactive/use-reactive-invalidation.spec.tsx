import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntifixQueryProvider, makeQueryClient } from '../query/query-provider.js';
import { makeInMemoryReactiveChannel } from './reactive-channel.js';
import { useReactiveInvalidation } from './use-reactive-invalidation.js';

describe('useReactiveInvalidation', () => {
  it('invalidates the entity scope when a change event arrives', () => {
    const client = makeQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const channel = makeInMemoryReactiveChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EntifixQueryProvider client={client}>{children}</EntifixQueryProvider>
    );

    renderHook(() => useReactiveInvalidation(channel), { wrapper });

    channel.emit({ entity: 'widget', change: 'updated', id: 'w-1' });

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

    channel.emit({ entity: 'widget', change: 'updated', id: 'w-1' });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
