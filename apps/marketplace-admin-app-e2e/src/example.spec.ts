import { expect, test } from './support/fixtures';

// Smoke check only: a signed-in visitor to `/` lands on the home page inside the
// back-office shell. It goes through the shared fixtures rather than
// `@playwright/test` directly so it arrives with a session — the app is gated,
// and an unauthenticated visit is a redirect to auth-app, not a page.
//
// `/` no longer renders a page of its own: middleware redirects it to
// `/<locale>/home`, whose body is the dashboard placeholder — so the assertion
// is on the shell landmarks, not on a heading the page does not have.
test('lands a signed-in visitor on the home page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/(es|en)\/home$/);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('navigation').first()).toBeVisible();
});
