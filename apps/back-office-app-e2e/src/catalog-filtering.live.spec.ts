import { requireLiveUrl } from '@r10c/entifix-ts-testing-e2e';
import {
  baseTest as test,
  expect,
} from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The half of the protocol the browser cannot reach.
 *
 * The metadata allowlist is enforced on the server, so the UI *cannot* compose
 * a query that violates it — which is the point. Driving the API directly is the
 * only way to prove the guard is there, and it needs the real service, so this
 * is live-only.
 *
 * Against **marketplace-service**, not the admin service: ADR 0022 moved brands
 * into the platform-plane `catalog-reference` store. That is also why no session
 * is needed. Reads there are unauthenticated by design — the storefront serves
 * anonymous traffic — so Playwright's cookie-less `request` fixture reaches the
 * allowlist instead of being turned away at a permission gate, and a `401` here
 * would now be the bug rather than the setup.
 *
 * Hence `baseTest` rather than the project fixtures: those seed a real session
 * through the provider's hosted UI for every spec, which this one neither needs
 * nor should depend on — it never opens a page, and a sign-in that broke would
 * otherwise fail three assertions about a service that was answering perfectly.
 */

const SERVICE_URL = requireLiveUrl('MARKETPLACE_SERVICE_URL');

test.describe('the server-side query allowlist', () => {
  test('rejects a query naming a member that is not filterable', async ({
    request,
  }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/product-brand?rsql=${encodeURIComponent('nope==1')}`,
    );

    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid query');
  });

  test('rejects a sort naming an unknown member', async ({ request }) => {
    const response = await request.get(
      `${SERVICE_URL}/api/product-brand?sort=nope`,
    );

    expect(response.status()).toBe(400);
  });

  // The read the allowlist is guarding must itself be reachable without a
  // session, or the two tests above would pass for the wrong reason.
  test('serves the brand listing to an anonymous caller', async ({
    request,
  }) => {
    const response = await request.get(`${SERVICE_URL}/api/product-brand`);

    expect(response.status()).toBe(200);
  });
});
