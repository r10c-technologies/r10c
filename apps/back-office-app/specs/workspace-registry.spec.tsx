import { workspaceRegistryFor } from '../src/app/(authenticated)/workspace/workspace-registry';
import { NAV } from '../src/lib/nav';

/**
 * The nav's `workspace:` address and the registry's key are two independently
 * maintained strings that must agree, and once did not — `catalog:product-
 * specification` against a `product` key, which resolved to nothing and made
 * "open in workspace" on Productos do nothing at all, silently.
 *
 * Both sides now derive from the same `CatalogSurface`, so the drift this was
 * written to catch is structurally gone for the catalog. It stays because the
 * host still composes fragments from three shells and can still gain one that
 * addresses a screen this registry does not offer — which is the same failure,
 * one level up.
 */
describe('the nav and the workspace registry agree', () => {
  const addresses = NAV.flatMap(section => section.items)
    .map(item => item.workspace)
    .filter((address): address is string => address !== undefined);

  it('has an address to check', () => {
    expect(addresses.length).toBeGreaterThan(0);
  });

  it.each(addresses)('resolves %s', address => {
    // Captions are catalog keys here; echoing the key back is enough to resolve.
    expect(
      workspaceRegistryFor(undefined).resolve(address, key => key),
    ).not.toBeNull();
  });
});

/**
 * A tab says what the page inside it says (#559). The page's heading comes
 * from the shell's `useListView`, the caption from the same table through the
 * registry, so a vendor's payouts tab is "Mis pagos" — and an operator's, and
 * every list the shell does not word, keeps the entity's own plural.
 */
describe('a settlement tab is captioned for whoever reads it', () => {
  const caption = (partyRole: string | undefined, address: string) =>
    workspaceRegistryFor(partyRole).resolve(address, key => key)?.title;

  it.each([
    ['operation:vendor-payout', 'r10c:settlement.nav.payouts_vendor'],
    ['operation:commission-entry', 'r10c:settlement.nav.entries_vendor'],
    ['master:agreement', 'r10c:settlement.nav.agreements_vendor'],
  ])('words %s for a vendor', (address, key) => {
    expect(caption('vendor', address)).toBe(key);
  });

  it('keeps the plural for an operator, and for a list nobody re-words', () => {
    expect(caption(undefined, 'operation:vendor-payout')).toBe(
      'entity:vendor-payout.plural',
    );
    expect(caption('vendor', 'operation:settlement-run')).toBe(
      'entity:settlement-run.plural',
    );
  });
});
