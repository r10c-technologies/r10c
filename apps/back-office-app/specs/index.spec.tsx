import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { NavPrincipal } from '../src/lib/nav-principal';

// The page resolves its own copy on the server; the catalog is covered in
// `@entifix/i18n`, so the key is echoed back here.
vi.mock('@entifix/next-i18n/server', () => ({
  getServerT: () => Promise.resolve((key: string) => key),
}));

// Who is reading comes from the access cookie, which only exists in a request.
let principal: NavPrincipal;
vi.mock('../src/lib/nav-principal', () => ({
  navPrincipal: () => Promise.resolve(principal),
}));

// Each tile is its own shell's, covered there; here they only need a name.
vi.mock('@r10c/shells-next-fulfilment', async importOriginal => ({
  ...(await importOriginal<object>()),
  DispatchTile: () => <span>dispatch</span>,
}));
vi.mock('@r10c/shells-next-stock', async importOriginal => ({
  ...(await importOriginal<object>()),
  OutOfStockTile: () => <span>out-of-stock</span>,
}));
vi.mock('@r10c/shells-next-order', async importOriginal => ({
  ...(await importOriginal<object>()),
  LatestOrdersTile: () => <span>latest-orders</span>,
}));
vi.mock('@r10c/shells-next-settlement', async importOriginal => ({
  ...(await importOriginal<object>()),
  BalanceTile: () => <span>balance</span>,
}));

import Page from '../src/app/(authenticated)/home/page';

// `/` redirects to `/<locale>/home`, so the page under `(authenticated)/home`
// is what a visitor actually lands on. It is an async server component: await
// it and render what it returns.
describe('AdminHomePage', () => {
  it('lays out the tiles a provisioned vendor is shown (#563)', async () => {
    principal = {
      roles: ['admin'],
      organizationId: 'org-1',
      entitlements: [
        'shipping-order-management',
        'order-management',
        'settlement-management',
      ],
      partyRole: 'vendor',
    };
    render(await Page());

    const list = screen.getByRole('list', { name: 'admin.home.tiles' });
    expect(list).toHaveTextContent('dispatch');
    expect(list).toHaveTextContent('balance');
    expect(list).toHaveTextContent('latest-orders');
    expect(list).not.toHaveTextContent('out-of-stock');
  });

  it('says what the home is for to a reader with no tile', async () => {
    principal = { roles: ['super-admin'], entitlements: [] };
    render(await Page());

    expect(screen.getByText('admin.home.none')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
