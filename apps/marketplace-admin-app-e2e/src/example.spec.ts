import { expect, test } from './support/fixtures';

// Smoke check only: the home page renders its heading. It goes through the
// shared fixtures rather than `@playwright/test` directly so it arrives with a
// session — the app is gated now, and an unauthenticated visit is a redirect to
// auth-app, not a page.
test('renders the landing heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toBeVisible();
});
