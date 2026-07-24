import 'fake-indexeddb/auto';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TabKind, TabRegistry } from './tab-kind.js';
import { useTabsStore } from './tabs-store.js';
import { WorkspaceShell } from './workspace-shell.js';

const replace = vi.fn();
let tabParam: string | null = null;

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(tabParam ? { tab: tabParam } : {}),
  useRouter: () => ({ replace }),
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

const renderShell = (actions?: boolean) =>
  render(
    <WorkspaceShell
      registry={registry}
      nav={<nav>nav</nav>}
      brand="r10c"
      actions={actions ? <button type="button">User</button> : undefined}
      emptyState={<div data-testid="empty">No open tabs</div>}
      fallback={<div data-testid="fallback">Unknown tab</div>}
    />,
  );

beforeEach(() => {
  replace.mockClear();
  tabParam = null;
  useTabsStore.setState({ tabs: [], activeParam: null });
  vi.spyOn(useTabsStore.persist, 'rehydrate').mockResolvedValue(undefined);
});

describe('WorkspaceShell', () => {
  it('shows the empty state when no tab is open', async () => {
    renderShell();
    expect(await screen.findByTestId('empty')).toBeInTheDocument();
  });

  it('renders top-bar actions when given', () => {
    renderShell(true);
    expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument();
  });

  it('opens and renders the tab named by a deep link', async () => {
    tabParam = 'catalog:product';
    renderShell();

    expect(await screen.findByTestId('body')).toHaveTextContent('list product');
    expect(screen.getByRole('tab', { name: /product catalog/ })).toBeInTheDocument();
  });

  it('shows the fallback for an unknown tab kind', async () => {
    tabParam = 'operation:import';
    renderShell();

    expect(await screen.findByTestId('fallback')).toBeInTheDocument();
  });

  it('activates a clicked tab and projects the active one to the URL', async () => {
    const user = userEvent.setup();
    renderShell();

    act(() => {
      const { open } = useTabsStore.getState();
      open({ param: 'catalog:product', title: 'product catalog' });
      open({ param: 'catalog:brand', title: 'brand catalog' });
    });

    // The last opened tab is active and projected to the address bar.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/workspace?tab=catalog%3Abrand'),
    );

    // Clicking another tab activates it.
    await user.click(screen.getByText('product catalog'));

    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: /product catalog/ }),
      ).toHaveAttribute('aria-selected', 'true'),
    );
    expect(
      screen.getByRole('tab', { name: /brand catalog/ }),
    ).toHaveAttribute('aria-selected', 'false');
  });

  it('closes a tab', async () => {
    tabParam = 'catalog:product';
    const user = userEvent.setup();
    renderShell();
    await screen.findByTestId('body');

    await user.click(screen.getByRole('button', { name: 'Close product catalog' }));

    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: /product catalog/ })).not.toBeInTheDocument(),
    );
  });
});
