import { homeTiles } from '../src/lib/home-tiles';
import type { NavPrincipal } from '../src/lib/nav-principal';

/**
 * The vendor home's tiles follow the sidebar's two ceilings, and one more: a
 * tile counts one organization's work, so a reader acting for none sees none
 * (#563).
 */
const EVERYTHING = [
  'shipping-order-management',
  'stock-management',
  'order-management',
  'settlement-management',
];

const vendor = (over: Partial<NavPrincipal> = {}): NavPrincipal => ({
  roles: ['admin'],
  organizationId: 'org-1',
  entitlements: EVERYTHING,
  partyRole: 'vendor',
  ...over,
});

describe('homeTiles', () => {
  it('shows a provisioned vendor every tile', () => {
    expect(homeTiles(vendor())).toEqual({
      dispatch: true,
      outOfStock: true,
      latestOrders: true,
      balance: true,
    });
  });

  it('leaves out the dispatch tile for an organization not provisioned to ship', () => {
    const tiles = homeTiles(
      vendor({
        entitlements: EVERYTHING.filter(
          entitlement => entitlement !== 'shipping-order-management',
        ),
      }),
    );

    expect(tiles.dispatch).toBe(false);
    expect(tiles.outOfStock).toBe(true);
  });

  it('shows an operator, acting for no organization, no tile at all', () => {
    expect(
      homeTiles({
        roles: ['super-admin'],
        entitlements: [],
        partyRole: 'operator',
      }),
    ).toEqual({
      dispatch: false,
      outOfStock: false,
      latestOrders: false,
      balance: false,
    });
  });
});
