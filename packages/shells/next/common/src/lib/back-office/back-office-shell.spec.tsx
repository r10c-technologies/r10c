import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackOfficeShell } from './back-office-shell.js';
import type { NavSection } from './nav.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/catalog/product' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const nav: NavSection[] = [
  {
    title: 'Catalog',
    type: 'master',
    items: [{ label: 'Products', href: '/catalog/product' }],
  },
];

type Listener = () => void;

/**
 * jsdom declares `matchMedia` and leaves it uncallable, so every test that
 * renders this shell has to supply one — and one that reports a width, since a
 * stub answering `false` to everything reads as the middle mode.
 */
const stubViewport = (width: number) => {
  const listeners: Listener[] = [];
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const max = /max-width: (\d+)px/.exec(query);
      const min = /min-width: (\d+)px/.exec(query);
      return {
        get matches() {
          if (max !== null) return width <= Number(max[1]);
          return min !== null && width >= Number(min[1]);
        },
        addEventListener: (_: string, listener: Listener) =>
          listeners.push(listener),
        removeEventListener: vi.fn(),
      };
    },
  });
};

beforeEach(() => {
  window.localStorage.clear();
  stubViewport(1400);
});

function renderShell(
  props: Partial<ComponentProps<typeof BackOfficeShell>> = {},
) {
  return render(
    <BackOfficeShell
      nav={nav}
      brand="Acme Admin"
      breadcrumbLabels={{ catalog: 'Catalog' }}
      {...props}
    >
      <p>Routed content</p>
    </BackOfficeShell>,
  );
}

describe('BackOfficeShell', () => {
  it('renders the brand, navigation, breadcrumbs and content when expanded', () => {
    renderShell();
    expect(screen.getByText('Acme Admin')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', {
      name: 'Ruta de navegación',
    });
    expect(within(crumbs).getByText('Product')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('Routed content')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Contraer barra lateral' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders an account menu in the top bar when one is given', () => {
    renderShell({
      accountMenu: <button type="button">ada@example.com</button>,
    });

    expect(
      screen.getByRole('button', { name: 'ada@example.com' }),
    ).toBeInTheDocument();
  });

  it('omits the account slot entirely when there is none', () => {
    renderShell();

    // The top bar carries only the collapse toggle and the crumbs.
    expect(
      screen.queryByRole('button', { name: 'ada@example.com' }),
    ).toBeNull();
  });

  it('collapses on toggle, hides the brand and persists the preference', async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();

    await user.click(
      screen.getByRole('button', { name: 'Contraer barra lateral' }),
    );

    const toggle = await screen.findByRole('button', {
      name: 'Expandir barra lateral',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Acme Admin')).toBeNull();

    // Persisted through the UiPreferencesState (localStorage adapter).
    await waitFor(() =>
      expect(
        window.localStorage.getItem('r10c-ui:back-office:sidebar-collapsed'),
      ).toBe('true'),
    );

    // A fresh mount reads the persisted collapsed state back.
    unmount();
    renderShell();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Expandir barra lateral' }),
      ).toBeInTheDocument(),
    );
  });
});

describe('BackOfficeShell, domain groups', () => {
  it('collapses a group and persists which ones are collapsed', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(
      await screen.findByRole('button', { name: 'Plegar Catalog' }),
    );

    // Hidden, and remembered — a group that re-expands on every reload is a
    // preference that was never really offered.
    await waitFor(() =>
      expect(screen.queryByText('Products')).toBeNull(),
    );
    await waitFor(() =>
      expect(
        window.localStorage.getItem('r10c-ui:back-office:nav-collapsed-groups'),
      ).toBe('{"Catalog":true}'),
    );
  });

  it('expands a group that was persisted collapsed', async () => {
    window.localStorage.setItem(
      'r10c-ui:back-office:nav-collapsed-groups',
      '{"Catalog":true}',
    );
    const user = userEvent.setup();
    renderShell();

    await user.click(
      await screen.findByRole('button', { name: 'Desplegar Catalog' }),
    );

    expect(await screen.findByText('Products')).toBeInTheDocument();
  });
});

describe('BackOfficeShell, at a narrow viewport', () => {
  it('puts navigation behind a drawer below the rail width', async () => {
    stubViewport(500);
    const user = userEvent.setup();
    renderShell();

    // No persistent sidebar at all: the aside would stack above the content and
    // scroll away, which is what "no mobile behaviour" looked like.
    expect(screen.queryByRole('navigation', { name: 'Principal' })).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Abrir el menú' }),
    );

    const drawer = await screen.findByRole('dialog');
    expect(
      within(drawer).getByRole('navigation', { name: 'Principal' }),
    ).toBeInTheDocument();
    // Labels, not icons: a drawer has the whole viewport and there is no
    // "beside the content" for the collapse preference to be about.
    expect(within(drawer).getByText('Products')).toBeInTheDocument();
  });

  it('closes the drawer on Escape', async () => {
    stubViewport(500);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Abrir el menú' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('forces the rail at a mid width without writing the preference', async () => {
    // The failure this is here for is silent and permanent: auto-collapse that
    // wrote the stored value would mean one visit at a narrow width rewrites a
    // choice made on a desktop, and the sidebar comes back collapsed there.
    stubViewport(900);
    renderShell();

    await waitFor(() =>
      expect(screen.queryByText('Acme Admin')).toBeNull(),
    );
    expect(
      window.localStorage.getItem('r10c-ui:back-office:sidebar-collapsed'),
    ).toBeNull();
  });
});
