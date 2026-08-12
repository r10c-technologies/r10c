import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistedDrafts,
  selectIsDirty,
  useDraftsState,
} from './drafts-state.js';

afterEach(() => {
  useDraftsState.setState({ drafts: {} });
});

describe('useDraftsState', () => {
  it('sets and overwrites a draft by address', () => {
    useDraftsState.getState().setDraft('entity:product:1', { name: 'A' });
    useDraftsState.getState().setDraft('entity:product:1', { name: 'B' });

    expect(useDraftsState.getState().drafts['entity:product:1']).toEqual({
      name: 'B',
    });
  });

  it('keeps drafts for different addresses independent', () => {
    const { setDraft } = useDraftsState.getState();
    setDraft('a', 1);
    setDraft('b', 2);

    expect(useDraftsState.getState().drafts).toEqual({ a: 1, b: 2 });
  });

  it('clears a draft', () => {
    useDraftsState.getState().setDraft('a', 1);
    useDraftsState.getState().clearDraft('a');

    expect('a' in useDraftsState.getState().drafts).toBe(false);
  });

  it('clearing an unknown draft is a no-op', () => {
    useDraftsState.getState().setDraft('a', 1);
    const before = useDraftsState.getState().drafts;

    useDraftsState.getState().clearDraft('missing');

    expect(useDraftsState.getState().drafts).toBe(before);
  });
});

describe('selectIsDirty', () => {
  it('is true only while a draft exists for the address', () => {
    expect(selectIsDirty('a')(useDraftsState.getState())).toBe(false);
    useDraftsState.getState().setDraft('a', 1);
    expect(selectIsDirty('a')(useDraftsState.getState())).toBe(true);
  });
});

describe('persistedDrafts', () => {
  it('keeps only the drafts map', () => {
    const persisted = persistedDrafts({
      drafts: { a: 1 },
      setDraft: () => undefined,
      clearDraft: () => undefined,
    });

    expect(persisted).toEqual({ drafts: { a: 1 } });
  });
});
