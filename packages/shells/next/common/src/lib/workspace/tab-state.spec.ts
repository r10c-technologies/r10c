import { describe, expect, it } from 'vitest';

import {
  closeTab,
  emptyTabs,
  openOrFocus,
  setActive,
  type TabsSnapshot,
} from './tab-state.js';

const withTabs = (...params: string[]): TabsSnapshot => ({
  tabs: params.map(param => ({ param, title: param })),
  activeParam: params.at(-1) ?? null,
});

describe('openOrFocus', () => {
  it('appends a new tab and makes it active', () => {
    const next = openOrFocus(emptyTabs, { param: 'catalog:product', title: 'Products' });

    expect(next.tabs).toHaveLength(1);
    expect(next.activeParam).toBe('catalog:product');
  });

  it('focuses and re-titles an already open tab instead of duplicating', () => {
    const state = withTabs('catalog:product', 'catalog:brand');

    const next = openOrFocus(state, { param: 'catalog:product', title: 'Renamed' });

    expect(next.tabs).toHaveLength(2);
    expect(next.tabs.find(t => t.param === 'catalog:product')?.title).toBe('Renamed');
    expect(next.activeParam).toBe('catalog:product');
  });
});

describe('closeTab', () => {
  it('is a no-op for an unknown tab', () => {
    const state = withTabs('a');
    expect(closeTab(state, 'missing')).toBe(state);
  });

  it('removes a non-active tab and keeps the active one', () => {
    const state: TabsSnapshot = { tabs: withTabs('a', 'b', 'c').tabs, activeParam: 'c' };

    const next = closeTab(state, 'a');

    expect(next.tabs.map(t => t.param)).toEqual(['b', 'c']);
    expect(next.activeParam).toBe('c');
  });

  it('activates the following tab when the active one closes', () => {
    const state: TabsSnapshot = { tabs: withTabs('a', 'b', 'c').tabs, activeParam: 'b' };

    const next = closeTab(state, 'b');

    expect(next.activeParam).toBe('c');
  });

  it('falls back to the previous tab when the last active tab closes', () => {
    const state: TabsSnapshot = { tabs: withTabs('a', 'b').tabs, activeParam: 'b' };

    const next = closeTab(state, 'b');

    expect(next.activeParam).toBe('a');
  });

  it('clears the active tab when the only tab closes', () => {
    const next = closeTab(withTabs('a'), 'a');

    expect(next.tabs).toHaveLength(0);
    expect(next.activeParam).toBeNull();
  });
});

describe('setActive', () => {
  it('focuses an open tab', () => {
    const next = setActive(withTabs('a', 'b'), 'a');
    expect(next.activeParam).toBe('a');
  });

  it('ignores an unknown tab', () => {
    const state = withTabs('a');
    expect(setActive(state, 'missing')).toBe(state);
  });
});
