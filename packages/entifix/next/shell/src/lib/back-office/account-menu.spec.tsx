import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountMenu } from './account-menu';

// The host supplies only URLs — the copy is the menu's own, resolved out of
// `shell:account.*`, so an item carries a catalog key and not a label.
const items = [
  {
    labelKey: 'account.profile' as const,
    href: 'http://localhost:3001/es/account',
  },
];

const renderMenu = (props: Partial<Parameters<typeof AccountMenu>[0]> = {}) =>
  render(<AccountMenu label="ada@example.com" items={items} {...props} />);

/** `window.location` is read-only in jsdom, so swap it for a plain object. */
const stubLocation = () => {
  const location = { href: '' } as Location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: location,
  });
  return location;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountMenu', () => {
  it('lists the account destinations as links', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'ada@example.com' }));

    const link = screen.getByRole('menuitem', { name: 'Perfil' });
    // An anchor, not a button: these are ordinary navigations.
    expect(link).toHaveAttribute('href', 'http://localhost:3001/es/account');
  });

  it('signs out through the app’s own handler and follows its redirect', async () => {
    const user = userEvent.setup();
    const location = stubLocation();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ redirect: 'http://localhost:3001' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderMenu();
    await user.click(screen.getByRole('button', { name: 'ada@example.com' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(location.href).toBe('http://localhost:3001'));
  });

  it('leaves the protected area even when sign-out fails', async () => {
    const user = userEvent.setup();
    const location = stubLocation();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    renderMenu({ signOutRedirect: 'http://fallback.test' });
    await user.click(screen.getByRole('button', { name: 'ada@example.com' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    // The cookies may already be gone; staying put would show a broken shell.
    await waitFor(() => expect(location.href).toBe('http://fallback.test'));
  });

  it('falls back when the handler answers without a redirect', async () => {
    const user = userEvent.setup();
    const location = stubLocation();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    renderMenu();
    await user.click(screen.getByRole('button', { name: 'ada@example.com' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    await waitFor(() => expect(location.href).toBe('/'));
  });

  it('posts to a custom sign-out endpoint', async () => {
    const user = userEvent.setup();
    stubLocation();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderMenu({ signOutEndpoint: '/custom/logout' });
    await user.click(screen.getByRole('button', { name: 'ada@example.com' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/custom/logout',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
