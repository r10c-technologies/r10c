import { isNavItemVisible, visibleNav } from '../src/lib/nav';
import type { NavPrincipal } from '../src/lib/nav-principal';

/**
 * Two independent ceilings decide what renders: what the person's roles grant,
 * and what their organization was provisioned for (ADR 0007). The second one
 * had never been read anywhere in the fleet before #125 — `Entitlement` rows
 * were seeded and consulted by nothing — so these are the first assertions that
 * it exists at all.
 *
 * Filtering here is presentation. The service is what refuses the request.
 */
const principal = (over: Partial<NavPrincipal> = {}): NavPrincipal => ({
  roles: ['super-admin'],
  organizationId: 'org-1',
  entitlements: ['product-configuration-management'],
  ...over,
});

const labels = (nav: ReturnType<typeof visibleNav>): string[] =>
  nav.flatMap(section => section.items).map(item => item.label);

describe('visibleNav', () => {
  it('shows a provisioned organization its own catalog', () => {
    expect(labels(visibleNav(principal()))).toContain('app:admin.nav.products');
  });

  it('hides Productos from an organization provisioned for nothing', () => {
    // The whole behavioural claim of #125, in one assertion.
    expect(labels(visibleNav(principal({ entitlements: [] })))).not.toContain(
      'app:admin.nav.products',
    );
  });

  it('keeps operator-owned vocabulary visible to an unprovisioned org', () => {
    // Brands and categories are `catalog-reference`, which ADR 0022 makes
    // permanently non-grantable: nobody buys the taxonomy every vendor is
    // classified into, so nobody may be refused it either. Gating these on the
    // entitlement is the mistake this test exists to catch.
    const visible = labels(visibleNav(principal({ entitlements: [] })));

    expect(visible).toContain('app:admin.nav.brands');
    expect(visible).toContain('app:admin.nav.categories');
  });

  it('ignores the entitlement ceiling for a session with no organization', () => {
    // Platform staff hold no tenant scope, so the ceiling does not apply rather
    // than denying everything. Keyed on the organization and not on an empty
    // entitlement list precisely so an operator's sidebar does not empty out.
    const operator = visibleNav({
      roles: ['super-admin'],
      entitlements: [],
    });

    expect(labels(operator)).toContain('app:admin.nav.products');
  });

  it('applies both ceilings, not whichever one passes', () => {
    // Entitled to the catalog, but holding no grant over it.
    expect(labels(visibleNav(principal({ roles: ['nobody'] })))).not.toContain(
      'app:admin.nav.products',
    );
  });

  it('drops a section once every item in it is filtered out', () => {
    const titles = visibleNav(principal({ roles: ['nobody'] })).map(
      section => section.title,
    );

    expect(titles).not.toContain('app:admin.nav.catalog');
  });

  it('carries the screen type through the filter', () => {
    // ADR 0033's top tier. Nothing renders it yet (#113/#123), so a filter that
    // dropped it would break nothing here and everything downstream.
    const catalog = visibleNav(principal()).find(
      section => section.title === 'app:admin.nav.catalog',
    );

    expect(catalog?.type).toBe('master');
  });

  it('refuses an entitlement-gated item that names no permission', () => {
    // There is no domain to read from, and both defaults read as a bug in
    // something else, so the declaration fails instead of guessing.
    expect(() =>
      isNavItemVisible(
        { label: 'shell:broken', href: '/broken', entitled: true },
        principal(),
      ),
    ).toThrow(/names no permission/);
  });
});
