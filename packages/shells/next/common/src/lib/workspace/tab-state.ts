/**
 * A single open tab. `param` is its `?tab=` value — both the deep-link address
 * and the tab's identity, so opening the same address twice focuses the one
 * that is already open rather than duplicating it.
 */
export interface TabRecord {
  param: string;
  title: string;
}

export interface TabsSnapshot {
  tabs: TabRecord[];
  activeParam: string | null;
}

export const emptyTabs: TabsSnapshot = { tabs: [], activeParam: null };

/**
 * Open a tab, or focus and re-title it if its address is already open. The
 * opened/focused tab becomes active.
 */
export function openOrFocus(
  state: TabsSnapshot,
  tab: TabRecord,
): TabsSnapshot {
  const exists = state.tabs.some(open => open.param === tab.param);
  const tabs = exists
    ? state.tabs.map(open =>
        open.param === tab.param ? { ...open, title: tab.title } : open,
      )
    : [...state.tabs, tab];
  return { tabs, activeParam: tab.param };
}

/**
 * Close a tab. If it was active, focus its neighbour (the tab that slides into
 * its place, else the one before it, else nothing). Closing an unknown tab is a
 * no-op.
 */
export function closeTab(state: TabsSnapshot, param: string): TabsSnapshot {
  const index = state.tabs.findIndex(open => open.param === param);
  if (index === -1) return state;

  const tabs = state.tabs.filter(open => open.param !== param);
  if (state.activeParam !== param) {
    return { tabs, activeParam: state.activeParam };
  }

  const neighbour = tabs[index] ?? tabs[index - 1];
  return { tabs, activeParam: neighbour?.param ?? null };
}

/** Focus an open tab; focusing an unknown one is a no-op. */
export function setActive(state: TabsSnapshot, param: string): TabsSnapshot {
  if (!state.tabs.some(open => open.param === param)) return state;
  return { ...state, activeParam: param };
}
