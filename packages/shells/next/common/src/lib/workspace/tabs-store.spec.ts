import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { persistedTabs, useTabsStore } from './tabs-store.js';

afterEach(() => {
  useTabsStore.setState({ tabs: [], activeParam: null });
});

describe('useTabsStore', () => {
  it('opens tabs and tracks the active one', () => {
    useTabsStore.getState().open({ param: 'catalog:product', title: 'Products' });
    useTabsStore.getState().open({ param: 'catalog:brand', title: 'Brands' });

    const state = useTabsStore.getState();
    expect(state.tabs.map(t => t.param)).toEqual(['catalog:product', 'catalog:brand']);
    expect(state.activeParam).toBe('catalog:brand');
  });

  it('focuses an already open tab instead of duplicating', () => {
    const { open } = useTabsStore.getState();
    open({ param: 'catalog:product', title: 'Products' });
    open({ param: 'catalog:brand', title: 'Brands' });
    open({ param: 'catalog:product', title: 'Products' });

    expect(useTabsStore.getState().tabs).toHaveLength(2);
    expect(useTabsStore.getState().activeParam).toBe('catalog:product');
  });

  it('closes a tab and re-activates a neighbour', () => {
    const { open, close } = useTabsStore.getState();
    open({ param: 'a', title: 'A' });
    open({ param: 'b', title: 'B' });
    close('b');

    expect(useTabsStore.getState().tabs.map(t => t.param)).toEqual(['a']);
    expect(useTabsStore.getState().activeParam).toBe('a');
  });

  it('activates an open tab', () => {
    const { open, activate } = useTabsStore.getState();
    open({ param: 'a', title: 'A' });
    open({ param: 'b', title: 'B' });
    activate('a');

    expect(useTabsStore.getState().activeParam).toBe('a');
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

    expect(persisted).toEqual({ tabs: [{ param: 'a', title: 'A' }], activeParam: 'a' });
    expect('open' in persisted).toBe(false);
  });
});
