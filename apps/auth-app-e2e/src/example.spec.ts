import { expect, test } from '@playwright/test';

test.describe('the sign-in surface', () => {
  test('has title', async ({ page }) => {
    await page.goto('/');

    // Expect h1 to contain a substring.
    expect(await page.locator('h1').innerText()).toContain('Sign in');
  });

  /**
   * The whole sign-in surface, asserted at the edge: there is no form, and the
   * single action leaves for the provider.
   *
   * `maxRedirects: 0` because following it would try to reach a Zitadel that is
   * not running in this hermetic profile. That the handler answers a redirect at
   * all is the claim — where it points is proved by the live pass.
   */
  test('offers one action that leaves for the hosted login', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    // No credential inputs anywhere on the page. This app holds no password, so
    // a field that collects one would mean something had crept back in.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(
      page.locator('a[href="/api/auth/oidc/start"]'),
    ).toBeVisible();

    const response = await request.get('/api/auth/oidc/start', {
      maxRedirects: 0,
    });
    expect([302, 307]).toContain(response.status());
  });
});
