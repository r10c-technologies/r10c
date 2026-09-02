import {
  baseTest as base,
  expect,
  seedSession,
} from '@r10c/entifix-ts-testing-e2e/playwright';

import { test } from './support/fixtures';

/**
 * The authorization surface of the app, as a user experiences it.
 *
 * `mock` only, and deliberately so: what is asserted here is the **app's** two
 * presentation-layer behaviours — the edge gate and the nav filter. The
 * decision that matters, `requirePermission` on marketplace-admin-service, is
 * asserted where it lives (`marketplace-admin-service-e2e`) rather than through
 * a browser that would be talking to an msw fixture anyway.
 */

test.describe('the sidebar', () => {
  test('shows the catalog to a signed-in admin', async ({ page }) => {
    await page.goto('/catalog/product-brand');

    // `.first()` because each entry renders twice — the page link and its
    // "open in workspace" sibling.
    const nav = page.getByRole('navigation');
    await expect(
      nav.getByRole('link', { name: 'Marcas' }).first(),
    ).toBeVisible();
    await expect(
      nav.getByRole('link', { name: 'Productos' }).first(),
    ).toBeVisible();
  });
});

// A separate `test` without the auto session fixture — these need a context
// that is either signed out or signed in as someone else.
base.describe('without an admin session', () => {
  base('bounces an unauthenticated request to sign-in', async ({ request }) => {
    // Asserted on the redirect itself rather than by navigating: what matters
    // is where the gate pointed, and following it would only prove the sign-in
    // card renders.
    //
    // Requested locale-prefixed on purpose. Locale resolution runs ahead of the
    // auth gate, so an unprefixed path spends this single hop on `/es/…` — the
    // prefixed form is what makes the gate itself the responder.
    const response = await request.get('/es/catalog/product-brand', {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(307);
    // Same origin now — sign-in is this host's own front door, so a refused
    // visitor never leaves the origin that holds their cookies.
    expect(response.headers()['location']).toContain('/es');
    // …carrying where the visitor was headed, so sign-in can return them.
    expect(response.headers()['location']).toContain('redirect=');
  });

  base(
    'hides the catalog from a role that cannot read it',
    async ({ page, context }) => {
      // Signed in, but with a role the grant table gives nothing — proof the nav
      // is filtered by the session's roles rather than rendered wholesale.
      await seedSession(context, { roles: ['nobody'] });

      await page.goto('/account');

      const nav = page.getByRole('navigation');
      await expect(nav.getByRole('link', { name: 'Marcas' })).toHaveCount(0);
      // `Perfil`, not `Cuenta`: the account entry used to be a single link this
      // app wrote itself, and is now the auth shell's section — a `Cuenta`
      // heading over Perfil / Seguridad / Sesiones, all derived from
      // `ACCOUNT_DESTINATIONS`. The assertion is unchanged in intent: a role the
      // grant table gives nothing still sees the account screens, which is what
      // proves the nav was filtered rather than emptied.
      await expect(
        nav.getByRole('link', { name: 'Perfil' }).first(),
      ).toBeVisible();
    },
  );

  base(
    'hides a domain the organization was never provisioned for',
    async ({ page, context }) => {
      // The second ceiling (ADR 0007): the role grants the catalog, the
      // organization did not buy it. `admin` still holds
      // `product-configuration-management:*:read`, so a nav filtered on roles
      // alone would show Productos here.
      await seedSession(context, { roles: ['admin'], entitlements: [] });

      await page.goto('/account');

      const nav = page.getByRole('navigation');
      await expect(nav.getByRole('link', { name: 'Productos' })).toHaveCount(0);
      // `catalog-reference` is operator-owned and never grantable (ADR 0022),
      // so an unprovisioned vendor keeps the vocabulary its offerings are
      // classified in. Gating these too is the failure this asserts against.
      await expect(
        nav.getByRole('link', { name: 'Marcas' }).first(),
      ).toBeVisible();
    },
  );

  base(
    'leaves platform staff outside the entitlement ceiling',
    async ({ page, context }) => {
      // No organization, so nothing to be provisioned for. The ceiling must not
      // apply at all — reading an empty entitlement list as "entitled to
      // nothing" would empty an operator's sidebar.
      await seedSession(context, {
        roles: ['super-admin'],
        activeOrganizationId: null,
        partyRole: 'operator',
        entitlements: [],
      });

      await page.goto('/account');

      await expect(
        page
          .getByRole('navigation')
          .getByRole('link', { name: 'Productos' })
          .first(),
      ).toBeVisible();
    },
  );
});
