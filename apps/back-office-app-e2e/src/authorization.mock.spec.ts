import { expect, test as base } from '@playwright/test';
import { seedSession } from '@r10c/entifix-ts-testing-e2e/playwright';

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
      await expect(
        nav.getByRole('link', { name: 'Cuenta' }).first(),
      ).toBeVisible();
    },
  );
});
