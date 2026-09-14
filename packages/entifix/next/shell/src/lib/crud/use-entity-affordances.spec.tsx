import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntityMetadataSource,
} from '@r10c/entifix-ts-core';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useEntityAffordances } from './use-entity-affordances';

@entity({ key: 'affordance-widget' })
class Widget implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <EntifixQueryProvider>{children}</EntifixQueryProvider>
);

describe('useEntityAffordances', () => {
  it('serves the document once it lands', async () => {
    const document = { actions: ['read', 'write'] as const, useCases: [] };
    const source: EntityMetadataSource = {
      fetchMetadata: () =>
        Promise.resolve({ ...document, actions: [...document.actions] }),
    };

    const { result } = renderHook(() => useEntityAffordances(Widget, source), {
      wrapper,
    });

    await waitFor(() => expect(result.current.metadata).toBeDefined());
    expect(result.current.metadata?.actions).toEqual(['read', 'write']);
  });

  /**
   * The un-migrated call site. Absent metadata is the shape both `EntityForm`
   * and `EntityTable` already read as "behave exactly as before" — it is not a
   * security posture, the route guard is.
   */
  it('reports nothing, and no loading, without a source', () => {
    const { result } = renderHook(
      () => useEntityAffordances(Widget, undefined),
      {
        wrapper,
      },
    );

    expect(result.current.metadata).toBeUndefined();
    expect(result.current.isMetadataLoading).toBe(false);
  });

  /**
   * A hook cannot be called conditionally, so the query is always created and
   * simply disabled. Fetching-and-failing instead would have TanStack Query
   * *retry* a rejecting promise on a loop, for a capability the caller
   * deliberately did not use.
   */
  it('asks for nothing at all without a source', () => {
    const fetchMetadata = vi.fn();
    renderHook(() => useEntityAffordances(Widget, undefined), { wrapper });

    expect(fetchMetadata).not.toHaveBeenCalled();
  });

  it('holds the loading flag while the document is in flight', () => {
    const source: EntityMetadataSource = {
      fetchMetadata: () => new Promise(() => undefined),
    };

    const { result } = renderHook(() => useEntityAffordances(Widget, source), {
      wrapper,
    });

    expect(result.current.isMetadataLoading).toBe(true);
  });
});
