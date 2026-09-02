import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type EntityMetadataDocument,
  type EntityMetadataSource,
} from '@r10c/entifix-ts-core';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EntifixQueryProvider } from '../../query/query-provider.js';
import { useEntityUseCases } from './use-entity-use-cases.js';

@entity({ domain: 'authn', key: 'user-identity' })
class UserIdentity implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const document: EntityMetadataDocument = {
  actions: ['read', 'write'],
  useCases: [
    {
      key: 'revoke-sessions',
      binding: 'entity',
      placement: 'context-independent',
      labelKey: 'entity:user-identity.useCases.revokeSessions',
    },
  ],
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <EntifixQueryProvider>{children}</EntifixQueryProvider>
);

const sourceOf = (
  fetchMetadata: EntityMetadataSource['fetchMetadata'],
): EntityMetadataSource => ({ fetchMetadata });

describe('useEntityUseCases', () => {
  it('reports loading, then the document', async () => {
    const source = sourceOf(vi.fn(async () => document));

    const { result } = renderHook(
      () => useEntityUseCases(UserIdentity, source),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.metadata).toBeUndefined();

    await waitFor(() => expect(result.current.metadata).toEqual(document));
    expect(result.current.error).toBeUndefined();
    expect(source.fetchMetadata).toHaveBeenCalledWith(UserIdentity);
  });

  /**
   * A caller with no source to offer — a generated page whose service has no
   * `$metadata` route. A hook cannot be called conditionally, so the query is
   * created and skipped; asking-and-failing instead would have TanStack Query
   * *retry* a rejecting promise on a loop for a capability nobody used.
   *
   * `isLoading` must be **false**, not the `pending` a disabled query reports:
   * every action surface holds a skeleton while it is true, and one that never
   * resolves is a permanent shimmer where the buttons should be.
   */
  it('asks for nothing, and reports no loading, without a source', () => {
    const { result } = renderHook(
      () => useEntityUseCases(UserIdentity, undefined),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.metadata).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces a failure instead of pretending the caller has no affordances', async () => {
    const source = sourceOf(
      vi.fn(async () => {
        throw new Error('metadata unavailable');
      }),
    );

    const { result } = renderHook(
      () => useEntityUseCases(UserIdentity, source),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.metadata).toBeUndefined();
  });
});
