import {
  baseTest as test,
  expect,
} from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The other half of the gate's bargain.
 *
 * `back-office.mock.spec.ts` asserts that a refused visitor is sent to sign-in
 * *carrying* where they were headed. This asserts the sign-in card hands that
 * value on — the step that was missing, which is why every deep link used to
 * land on `/home`.
 *
 * The href is the whole assertion, and deliberately so: the round trip past this
 * point runs server-side (`oidcStartRoute` and `oidcCallbackRoute` both `fetch`
 * auth-service), where `page.route()` cannot see it. Those legs are covered
 * where they are real — `redirect.spec.ts` for the allowlist, `auth-service-e2e`
 * for the state exchange.
 *
 * `test` comes from `@playwright/test` rather than `./support/fixtures`: that
 * module's `session` fixture is `auto: true`, and an authenticated `/es` is
 * `signedOutOnly`, so the middleware would bounce it to `/es/home` and the card
 * would never render.
 */
test.describe('the sign-in card', () => {
  test('forwards the redirect the gate handed it', async ({ page }) => {
    // Locale-prefixed, for the same reason the gate spec is: locale resolution
    // runs ahead of everything and an unprefixed URL spends a hop on it.
    await page.goto('/es?redirect=%2Fcatalog%2Fproduct-brand');

    await expect(page.getByRole('link', { name: 'Continuar' })).toHaveAttribute(
      'href',
      '/api/auth/oidc/start?redirect=%2Fcatalog%2Fproduct-brand',
    );
  });

  test('links to the bare start route when there is nowhere to return to', async ({
    page,
  }) => {
    await page.goto('/es');

    await expect(page.getByRole('link', { name: 'Continuar' })).toHaveAttribute(
      'href',
      '/api/auth/oidc/start',
    );
  });
});
