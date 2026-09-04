import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraftsState } from './drafts-state.js';
import { useEntityDraft } from './use-entity-draft.js';

beforeEach(() => {
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

describe('useEntityDraft', () => {
  it('reads the draft stored at its address', () => {
    useDraftsState.getState().setDraft('entity:product-brand:b-1', {
      name: 'Acme',
    });

    const { result } = renderHook(() =>
      useEntityDraft('entity:product-brand:b-1'),
    );

    expect(result.current.draft).toEqual({ name: 'Acme' });
  });

  it('persists and clears through the store', async () => {
    const { result } = renderHook(() =>
      useEntityDraft('entity:product-brand:b-1'),
    );

    expect(result.current.draft).toBeUndefined();

    await act(async () => {
      result.current.save({ name: 'Acme' });
    });
    await waitFor(() => expect(result.current.draft).toEqual({ name: 'Acme' }));

    await act(async () => {
      result.current.clear();
    });
    await waitFor(() => expect(result.current.draft).toBeUndefined());
  });

  /**
   * The port's one hard requirement. `useEntityForm` autosaves from an effect
   * keyed on `save`, so an identity that changes per render turns every render
   * into an IndexedDB write — and the effect would fire before any edit.
   */
  it('keeps a stable identity while the draft is unchanged', () => {
    const { result, rerender } = renderHook(() =>
      useEntityDraft('entity:product-brand:b-1'),
    );
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('keeps drafts at different addresses apart', async () => {
    const brand = renderHook(() => useEntityDraft('entity:product-brand:b-1'));
    const category = renderHook(() =>
      useEntityDraft('entity:product-category:c-1'),
    );

    await act(async () => {
      brand.result.current.save({ name: 'Acme' });
    });

    await waitFor(() =>
      expect(brand.result.current.draft).toEqual({ name: 'Acme' }),
    );
    expect(category.result.current.draft).toBeUndefined();
  });
});
