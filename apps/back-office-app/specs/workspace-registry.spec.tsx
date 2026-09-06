import { workspaceRegistry } from '../src/app/(authenticated)/workspace/workspace-registry';
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
    expect(workspaceRegistry.resolve(address, key => key)).not.toBeNull();
  });
});
