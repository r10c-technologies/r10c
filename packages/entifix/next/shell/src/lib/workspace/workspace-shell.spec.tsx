import 'fake-indexeddb/auto';

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDraftsState } from './drafts-state.js';
import { type TabKind, TabRegistry } from './tab-kind.js';
import { useTabsState } from './tabs-state.js';
import { WorkspaceShell } from './workspace-shell.js';

const replace = vi.fn();
let tabParam: string | null = null;

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(tabParam ? { tab: tabParam } : {}),
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
      scope="user-1:org-1"
      registry={registry}
      actions={actions ? <button type="button">User</button> : undefined}
      emptyState={<div data-testid="empty">No open tabs</div>}
      fallback={<div data-testid="fallback">Unknown tab</div>}
    />,
  );

beforeEach(() => {
  replace.mockClear();
  tabParam = null;
  useTabsState.setState({ tabs: [], activeParam: null });
  useDraftsState.setState({ drafts: {} });
  vi.spyOn(useTabsState.persist, 'setOptions').mockImplementation(
    () => undefined,
  );
  vi.spyOn(useDraftsState.persist, 'setOptions').mockImplementation(
    () => undefined,
  );
  vi.spyOn(useTabsState.persist, 'rehydrate').mockResolvedValue(undefined);
  vi.spyOn(useDraftsState.persist, 'rehydrate').mockResolvedValue(undefined);
});

describe('WorkspaceShell', () => {
  it('shows the empty state when no tab is open', async () => {
    renderShell();
    expect(await screen.findByTestId('empty')).toBeInTheDocument();
  });

  // Order is the whole assertion. The storage key decides *whose* tabs and
  // drafts come back, so pointing the stores after the read would restore the
  // unscoped set first and only then start writing to the right key.
  it('points both stores at the caller’s scope before reading them', async () => {
    const order: string[] = [];
    vi.mocked(useTabsState.persist.setOptions).mockImplementation(() => {
      order.push('tabs:setOptions');
    });
    vi.mocked(useDraftsState.persist.setOptions).mockImplementation(() => {
      order.push('drafts:setOptions');
    });
    vi.mocked(useTabsState.persist.rehydrate).mockImplementation(async () => {
      order.push('rehydrate');
    });

    renderShell();
    await screen.findByTestId('empty');

    expect(useTabsState.persist.setOptions).toHaveBeenCalledWith({
      name: 'tabs:user-1:org-1',
    });
    expect(useDraftsState.persist.setOptions).toHaveBeenCalledWith({
      name: 'drafts:user-1:org-1',
    });
    expect(order.indexOf('rehydrate')).toBeGreaterThan(
      order.indexOf('drafts:setOptions'),
    );
  });

  it('renders top-bar actions when given', () => {
    renderShell(true);
    expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument();
  });

  it('opens and renders the tab named by a deep link', async () => {
    tabParam = 'catalog:product';
    renderShell();

    expect(await screen.findByTestId('body')).toHaveTextContent('list product');
    expect(
      screen.getByRole('tab', { name: /product catalog/ }),
    ).toBeInTheDocument();
  });

  it('copies a deep link to the active tab', async () => {
    tabParam = 'catalog:product';
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderShell();
    await screen.findByTestId('body');

    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('/workspace?tab=catalog%3Aproduct'),
    );
  });

  it('shows the fallback for an unknown tab kind', async () => {
    tabParam = 'operation:import';
    renderShell();

    expect(await screen.findByTestId('fallback')).toBeInTheDocument();
  });

  // The reported bug's second half: an unresolvable `?tab=` was dropped on the
  // floor. With a tab already open the fallback never showed — the open tab's
  // body did — and the write-back then replaced the address with that tab, so
  // even the URL stopped saying what had been asked for.
  it('answers a dead deep link with the fallback over an open tab', async () => {
    act(() => {
      useTabsState
        .getState()
        .open({ param: 'catalog:product', title: 'product catalog' });
    });
    tabParam = 'operation:import';
    renderShell();

    expect(await screen.findByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('body')).not.toBeInTheDocument();
    // Nothing in the strip claims to be what is on screen.
    expect(
      screen.getByRole('tab', { name: /product catalog/ }),
    ).toHaveAttribute('aria-selected', 'false');
    // And the address the visitor followed is left where they can read it.
    expect(replace).not.toHaveBeenCalled();
  });

  it('recovers from a dead deep link when a tab is clicked', async () => {
    const user = userEvent.setup();
    act(() => {
      useTabsState
        .getState()
        .open({ param: 'catalog:product', title: 'product catalog' });
    });
    tabParam = 'operation:import';
    renderShell();
    await screen.findByTestId('fallback');

    await user.click(screen.getByText('product catalog'));

    expect(await screen.findByTestId('body')).toHaveTextContent('list product');
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/workspace?tab=catalog%3Aproduct'),
    );
  });

  // Captions are re-derived from the registry each render so a locale switch
  // relabels open tabs. A tab persisted under a kind that no longer exists has
  // nothing to re-derive from, and falls back to whatever was stored.
  it('keeps the stored caption for a tab whose kind is gone', async () => {
    act(() => {
      useTabsState
        .getState()
        .open({ param: 'operation:import', title: 'Retired import' });
    });
    renderShell();

    expect(await screen.findByText('Retired import')).toBeInTheDocument();
  });

  it('activates a clicked tab and projects the active one to the URL', async () => {
    const user = userEvent.setup();
    renderShell();

    act(() => {
      const { open } = useTabsState.getState();
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
    expect(screen.getByRole('tab', { name: /brand catalog/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('closes a clean tab without confirming', async () => {
    tabParam = 'catalog:product';
    const user = userEvent.setup();
    renderShell();
    await screen.findByTestId('body');

    await user.click(
      screen.getByRole('button', { name: 'Cerrar product catalog' }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('tab', { name: /product catalog/ }),
      ).not.toBeInTheDocument(),
    );
    // Asserted rather than implied: the guard is a rendered dialog now, so a
    // clean close is only correct if nothing was put on screen to dismiss.
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument();
  });

  it('marks a tab dirty when its address has a draft', async () => {
    tabParam = 'catalog:product';
    renderShell();
    await screen.findByTestId('body');

    act(() => {
      useDraftsState.getState().setDraft('catalog:product', { name: 'x' });
    });

    await waitFor(() =>
      expect(screen.getByTestId('tab-indicator')).toBeInTheDocument(),
    );
  });

  it('guards closing a dirty tab and keeps it when cancelled', async () => {
    tabParam = 'catalog:product';
    const user = userEvent.setup();
    renderShell();
    await screen.findByTestId('body');
    act(() => {
      useDraftsState.getState().setDraft('catalog:product', { name: 'x' });
    });

    await user.click(
      screen.getByRole('button', { name: 'Cerrar product catalog' }),
    );

    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(
      screen.getByRole('tab', { name: /product catalog/ }),
    ).toBeInTheDocument();
    // The draft is the thing being protected — surviving the cancel is the
    // whole point, and a tab that stays while its draft is dropped would pass
    // the assertion above.
    expect('catalog:product' in useDraftsState.getState().drafts).toBe(true);
  });

  it('closes a dirty tab and clears its draft when confirmed', async () => {
    tabParam = 'catalog:product';
    const user = userEvent.setup();
    renderShell();
    await screen.findByTestId('body');
    act(() => {
      useDraftsState.getState().setDraft('catalog:product', { name: 'x' });
    });

    await user.click(
      screen.getByRole('button', { name: 'Cerrar product catalog' }),
    );

    await screen.findByTestId('confirm-dialog');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('tab', { name: /product catalog/ }),
      ).not.toBeInTheDocument(),
    );
    expect('catalog:product' in useDraftsState.getState().drafts).toBe(false);
  });
});
