import 'fake-indexeddb/auto';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraft, useDraftsState } from './drafts-state.js';

beforeEach(() => {
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

// A `type`, not an `interface`: TypeScript gives an interface no implicit index
// signature, so it never satisfies `JsonValue` however JSON-shaped it is. See
// `useDraft`'s note — that is the constraint's one sharp edge.
type Fields = { name: string };

describe('useDraft', () => {
  it('starts empty, persists edits, and clears', async () => {
    const { result } = renderHook(() => useDraft<Fields>('entity:product:1'));

    expect(result.current.draft).toBeUndefined();

    await act(async () => {
      result.current.setDraft({ name: 'Widget' });
    });
    await waitFor(() =>
      expect(result.current.draft).toEqual({ name: 'Widget' }),
    );

    await act(async () => {
      result.current.clearDraft();
    });
    await waitFor(() => expect(result.current.draft).toBeUndefined());
  });

  it('scopes drafts by address', async () => {
    const a = renderHook(() => useDraft<Fields>('a'));
    const b = renderHook(() => useDraft<Fields>('b'));

    await act(async () => {
      a.result.current.setDraft({ name: 'from-a' });
    });

    await waitFor(() =>
      expect(a.result.current.draft).toEqual({ name: 'from-a' }),
    );
    expect(b.result.current.draft).toBeUndefined();
  });
});
