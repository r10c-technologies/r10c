import 'fake-indexeddb/auto';

import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraftsState } from './drafts-state.js';
import { type TabKind, TabRegistry } from './tab-kind.js';
import { useTabsState } from './tabs-state.js';
import { WorkspaceShell } from './workspace-shell.js';

/**
 * A `next/navigation` double that closes the loop the real router closes:
 * `router.replace` actually writes the new `?tab=` back into what
 * `useSearchParams` returns, and re-renders the subscriber. The original spec's
 * `replace` was an inert `vi.fn()`, which is why a URL⇄store ping-pong could
 * never show up there.
 */
const replace = vi.fn();
let tabParam: string | null = null;
let notify: (() => void) | null = null;

vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    const [, force] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      notify = force;
      return () => {
        notify = null;
      };
    }, []);
    return new URLSearchParams(tabParam ? { tab: tabParam } : {});
  },
  useRouter: () => ({
    replace: (href: string) => {
      replace(href);
      tabParam = new URL(href, 'http://localhost').searchParams.get('tab');
      notify?.();
    },
  }),
  usePathname: () => '/workspace',
}));

const catalogKind: TabKind<{ key: string }> = {
  kind: 'catalog',
  match: payload => (payload ? { key: payload } : null),
  toParam: addr => addr.key,
  title: addr => `${addr.key} catalog`,
  render: addr => <div data-testid="body">list {addr.key}</div>,
};
const registry = new TabRegistry().register(catalogKind);

const renderShell = () =>
  render(
    <WorkspaceShell
      registry={registry}
      emptyState={<div data-testid="empty">No open tabs</div>}
      fallback={<div data-testid="fallback">Unknown tab</div>}
    />,
  );

beforeEach(() => {
  replace.mockClear();
  tabParam = null;
  notify = null;
  useTabsState.setState({ tabs: [], activeParam: null });
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useTabsState.persist, 'rehydrate').mockResolvedValue(undefined);
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

describe('WorkspaceShell URL sync', () => {
  // The reported flicker: with one tab already open and active, following a
  // sidebar link to a *second* tab makes the URL and the store disagree for one
  // commit. If the write-back reads the render snapshot instead of the
  // committed store, each side keeps correcting the other, forever.
  it('settles after a link opens a second tab', async () => {
    tabParam = 'catalog:brand';
    renderShell();
    await screen.findByTestId('body');

    // The sidebar link navigates: the URL now names a different tab than the
    // one the store has active.
    act(() => {
      tabParam = 'catalog:category';
      notify?.();
    });

    await waitFor(() =>
      expect(screen.getByTestId('body')).toHaveTextContent('list category'),
    );

    const settled = replace.mock.calls.length;
    await act(() => new Promise(resolve => setTimeout(resolve, 200)));

    expect(replace.mock.calls.length).toBe(settled);
    expect(tabParam).toBe('catalog:category');
    expect(useTabsState.getState().activeParam).toBe('catalog:category');
  });

  // The persisted snapshot lands *after* the first commit, and it carries its
  // own `activeParam`. Before the shell held its URL effects back, that
  // restored value overwrote the tab the deep link named, and the write-back
  // then projected the wrong tab into the address bar — so a shared link
  // opened whatever the recipient had open last.
  it('keeps the deep-linked tab when rehydration restores another one', async () => {
    vi.spyOn(useTabsState.persist, 'rehydrate').mockImplementation(async () => {
      await Promise.resolve();
      useTabsState.setState({
        tabs: [{ param: 'catalog:category', title: 'category catalog' }],
        activeParam: 'catalog:category',
      });
    });

    tabParam = 'catalog:brand';
    renderShell();

    await waitFor(() =>
      expect(screen.getByTestId('body')).toHaveTextContent('list brand'),
    );
    await act(() => new Promise(resolve => setTimeout(resolve, 200)));

    expect(useTabsState.getState().activeParam).toBe('catalog:brand');
    expect(tabParam).toBe('catalog:brand');
    // The restored tab is still open — only the *active* one is the URL's.
    expect(useTabsState.getState().tabs.map(tab => tab.param)).toContain(
      'catalog:category',
    );
  });

  it('settles after the user clicks another open tab', async () => {
    tabParam = 'catalog:brand';
    renderShell();
    await screen.findByTestId('body');

    act(() => {
      useTabsState.getState().open({
        param: 'catalog:category',
        title: 'category catalog',
      });
    });
    await waitFor(() => expect(tabParam).toBe('catalog:category'));

    act(() => {
      useTabsState.getState().activate('catalog:brand');
    });

    await waitFor(() => expect(tabParam).toBe('catalog:brand'));

    const settled = replace.mock.calls.length;
    await act(() => new Promise(resolve => setTimeout(resolve, 200)));

    expect(replace.mock.calls.length).toBe(settled);
    expect(useTabsState.getState().activeParam).toBe('catalog:brand');
  });
});
