import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  type DraftsState,
  mergeDrafts,
  migrateDrafts,
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

describe('migrateDrafts', () => {
  // Discard, never guess: a draft whose envelope this build cannot read is an
  // unfinished edit, so losing it costs a retype — while migrating it blind
  // risks submitting values whose meaning has changed.
  it('drops every draft written under an older envelope', () => {
    expect(migrateDrafts()).toEqual({ drafts: {} });
  });
});

describe('mergeDrafts', () => {
  const current: DraftsState = {
    drafts: {},
    setDraft: () => undefined,
    clearDraft: () => undefined,
  };

  it('restores the drafts that survived a JSON round trip', () => {
    const merged = mergeDrafts(
      { drafts: { 'entity:product:1': { name: 'A', stock: '2' } } },
      current,
    );

    expect(merged.drafts).toEqual({
      'entity:product:1': { name: 'A', stock: '2' },
    });
    expect(merged.setDraft).toBe(current.setDraft);
  });

  // Per entry, not all-or-nothing: one draft written by a build that predates
  // the JSON rule must not take the rest of the workspace's drafts with it.
  it('drops only the entry that is not JSON', () => {
    const merged = mergeDrafts(
      {
        drafts: {
          good: { name: 'A' },
          bad: { at: new Date() } as unknown as Record<string, string>,
        },
      },
      current,
    );

    expect(Object.keys(merged.drafts)).toEqual(['good']);
  });

  it('keeps the current state when nothing readable was persisted', () => {
    expect(mergeDrafts(undefined, current)).toBe(current);
    expect(mergeDrafts({ drafts: null }, current)).toBe(current);
    expect(mergeDrafts({ drafts: 'nonsense' }, current)).toBe(current);
  });
});
