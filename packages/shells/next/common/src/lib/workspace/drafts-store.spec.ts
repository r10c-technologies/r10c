import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistedDrafts,
  selectIsDirty,
  useDraftsStore,
} from './drafts-store.js';

afterEach(() => {
  useDraftsStore.setState({ drafts: {} });
});

describe('useDraftsStore', () => {
  it('sets and overwrites a draft by address', () => {
    useDraftsStore.getState().setDraft('entity:product:1', { name: 'A' });
    useDraftsStore.getState().setDraft('entity:product:1', { name: 'B' });

    expect(useDraftsStore.getState().drafts['entity:product:1']).toEqual({
      name: 'B',
    });
  });

  it('keeps drafts for different addresses independent', () => {
    const { setDraft } = useDraftsStore.getState();
    setDraft('a', 1);
    setDraft('b', 2);

    expect(useDraftsStore.getState().drafts).toEqual({ a: 1, b: 2 });
  });

  it('clears a draft', () => {
    useDraftsStore.getState().setDraft('a', 1);
    useDraftsStore.getState().clearDraft('a');

    expect('a' in useDraftsStore.getState().drafts).toBe(false);
  });

  it('clearing an unknown draft is a no-op', () => {
    useDraftsStore.getState().setDraft('a', 1);
    const before = useDraftsStore.getState().drafts;

    useDraftsStore.getState().clearDraft('missing');

    expect(useDraftsStore.getState().drafts).toBe(before);
  });
});

describe('selectIsDirty', () => {
  it('is true only while a draft exists for the address', () => {
    expect(selectIsDirty('a')(useDraftsStore.getState())).toBe(false);
    useDraftsStore.getState().setDraft('a', 1);
    expect(selectIsDirty('a')(useDraftsStore.getState())).toBe(true);
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
