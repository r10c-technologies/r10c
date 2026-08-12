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
    items: [{ label: 'Products', href: '/catalog/product' }],
  },
];

beforeEach(() => {
  window.localStorage.clear();
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
    const crumbs = screen.getByRole('navigation', { name: 'Ruta de navegación' });
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
    renderShell({ accountMenu: <button type="button">ada@example.com</button> });

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

    await user.click(screen.getByRole('button', { name: 'Contraer barra lateral' }));

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
