import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { persistedTabs, useTabsState } from './tabs-state.js';

afterEach(() => {
  useTabsState.setState({ tabs: [], activeParam: null });
});

describe('useTabsState', () => {
  it('opens tabs and tracks the active one', () => {
    useTabsState
      .getState()
      .open({ param: 'catalog:product', title: 'Products' });
    useTabsState.getState().open({ param: 'catalog:brand', title: 'Brands' });

    const state = useTabsState.getState();
    expect(state.tabs.map(t => t.param)).toEqual([
      'catalog:product',
      'catalog:brand',
    ]);
    expect(state.activeParam).toBe('catalog:brand');
  });

  it('focuses an already open tab instead of duplicating', () => {
    const { open } = useTabsState.getState();
    open({ param: 'catalog:product', title: 'Products' });
    open({ param: 'catalog:brand', title: 'Brands' });
    open({ param: 'catalog:product', title: 'Products' });

    expect(useTabsState.getState().tabs).toHaveLength(2);
    expect(useTabsState.getState().activeParam).toBe('catalog:product');
  });

  it('closes a tab and re-activates a neighbour', () => {
    const { open, close } = useTabsState.getState();
    open({ param: 'a', title: 'A' });
    open({ param: 'b', title: 'B' });
    close('b');

    expect(useTabsState.getState().tabs.map(t => t.param)).toEqual(['a']);
    expect(useTabsState.getState().activeParam).toBe('a');
  });

  it('activates an open tab', () => {
    const { open, activate } = useTabsState.getState();
    open({ param: 'a', title: 'A' });
    open({ param: 'b', title: 'B' });
    activate('a');

    expect(useTabsState.getState().activeParam).toBe('a');
  });
});

describe('persistedTabs', () => {
  it('keeps only the serialisable data', () => {
    const persisted = persistedTabs({
      tabs: [{ param: 'a', title: 'A' }],
      activeParam: 'a',
      open: () => undefined,
      close: () => undefined,
      activate: () => undefined,
    });

    expect(persisted).toEqual({
      tabs: [{ param: 'a', title: 'A' }],
      activeParam: 'a',
    });
    expect('open' in persisted).toBe(false);
  });
});
